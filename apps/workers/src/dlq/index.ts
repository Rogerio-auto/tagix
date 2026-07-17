/**
 * apps/workers/src/dlq — operação da Dead-Letter Queue (`hm.q.dlq`).
 *
 * A malha de entrega resiliente (DLX + retry + DLQ) vive em `@hm/shared/mq`
 * (`retry.ts` / `dlq.ts`). Este módulo é a camada operacional para os WORKERS:
 * inspecionar, reprocessar (replay) e esvaziar a DLQ. A UI visual é F52-S09.
 *
 * Uso via CLI (a partir da raiz do monorepo):
 *   pnpm --filter @hm/workers exec tsx --env-file=../../.env src/dlq/cli.ts inspect
 *   pnpm --filter @hm/workers exec tsx --env-file=../../.env src/dlq/cli.ts replay --max 100
 *   pnpm --filter @hm/workers exec tsx --env-file=../../.env src/dlq/cli.ts purge
 */
import {
  DLQ_QUEUE,
  assertDlq,
  connectMq,
  inspectDlq,
  purgeDlq,
  replayDlq,
  type DlqRecord,
  type MqHandle,
} from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import { captureException, setDlqDepth } from '../observability/index';

export { inspectDlq, replayDlq, purgeDlq, type DlqRecord } from '@hm/shared/mq';

/** Conecta, garante a DLQ declarada e executa `fn`, fechando tudo ao final. */
export async function withDlqChannel<T>(fn: (handle: MqHandle) => Promise<T>): Promise<T> {
  const handle = await connectMq();
  try {
    await assertDlq(handle.channel);
    return await fn(handle);
  } finally {
    await handle.channel.close().catch(() => undefined);
    await handle.connection.close().catch(() => undefined);
  }
}

/** Lê (sem remover) até `max` mensagens da DLQ. */
export async function inspect(max = 50): Promise<DlqRecord[]> {
  return withDlqChannel(({ channel }) => inspectDlq(channel, { max }));
}

/** Reenvia até `max` mensagens da DLQ para suas filas de origem. Retorna o total movido. */
export async function replay(max = 50, resetRetries = true): Promise<number> {
  return withDlqChannel(({ channel }) => replayDlq(channel, { max, resetRetries }));
}

/** Esvazia a DLQ. Retorna o nº de mensagens removidas. */
export async function purge(): Promise<number> {
  return withDlqChannel(({ channel }) => purgeDlq(channel));
}

// ------------------------------------------------------------ monitor (F56-S17)

/** Canal AMQP derivado de `@hm/shared/mq`. */
type MqChannel = MqHandle['channel'];

/**
 * Profundidade ATUAL da DLQ, de forma NÃO-destrutiva. `checkQueue` é um declare
 * passivo (não cria nem consome) — pré-condição: a fila já existe (`assertDlq`).
 */
export async function dlqDepth(channel: MqChannel): Promise<number> {
  const res = await channel.checkQueue(DLQ_QUEUE);
  return res.messageCount;
}

/**
 * Regra de alerta: dispara quando a DLQ atingiu/ultrapassou o limiar E cresceu
 * desde a última medição (mensagens NOVAS morreram). Evita spam a cada tick de
 * um backlog estável — o alerta reflete DETERIORAÇÃO, não um estado parado.
 */
export function shouldAlertDlq(prevDepth: number, depth: number, threshold: number): boolean {
  return depth >= threshold && depth > prevDepth;
}

const DEFAULT_DLQ_MONITOR_INTERVAL_MS = 30_000;
const DEFAULT_DLQ_ALERT_THRESHOLD = 1;

/** Lê `DLQ_MONITOR_INTERVAL_MS` (default 30s), com fallback seguro. */
export function dlqMonitorIntervalFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['DLQ_MONITOR_INTERVAL_MS'];
  if (raw === undefined || raw.length === 0) return DEFAULT_DLQ_MONITOR_INTERVAL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DLQ_MONITOR_INTERVAL_MS;
}

export interface DlqMonitorDeps {
  readonly logger: Logger;
  readonly intervalMs?: number;
  /** Limiar de mensagens mortas para alertar (default 1). */
  readonly alertThreshold?: number;
  /** Fábrica de conexão (testes injetam um fake). Default: `connectMq` resiliente. */
  readonly connect?: () => Promise<MqHandle>;
}

export interface DlqMonitorHandle {
  stop(): Promise<void>;
}

/**
 * Estado + uma passada do monitor. Exportado para o bootstrap/testes dispararem
 * um tick determinístico. Atualiza a métrica `hm_dlq_depth` e alerta (log
 * estruturado + Sentry) quando mensagens NOVAS caem na DLQ. Nunca lança — um
 * erro de leitura (AMQP caído) é logado e o próximo tick tenta de novo.
 */
export async function runDlqMonitorTick(
  channel: MqChannel,
  state: { prevDepth: number },
  deps: { readonly logger: Logger; readonly alertThreshold: number },
): Promise<number | null> {
  let depth: number;
  try {
    depth = await dlqDepth(channel);
  } catch (err: unknown) {
    deps.logger.warn('dlq-monitor: falha ao ler profundidade da DLQ', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  setDlqDepth(depth);
  if (shouldAlertDlq(state.prevDepth, depth, deps.alertThreshold)) {
    const delta = depth - state.prevDepth;
    deps.logger.error('dlq-monitor: mensagens mortas acumulando na DLQ', {
      queue: DLQ_QUEUE,
      depth,
      delta,
    });
    captureException(new Error(`DLQ ${DLQ_QUEUE} com ${depth} mensagens mortas (+${delta})`), {
      queue: DLQ_QUEUE,
      depth,
      delta,
    });
  }
  state.prevDepth = depth;
  return depth;
}

/**
 * Monitor de DLQ: abre uma conexão dedicada, garante a DLQ e, a cada
 * `intervalMs`, publica a profundidade em `hm_dlq_depth` + alerta em novas
 * mortes. Reentrância protegida; erros de tick não derrubam o monitor. A conexão
 * é aberta preguiçosamente no 1º tick (nada de I/O em escopo de módulo).
 */
export function startDlqMonitor(deps: DlqMonitorDeps): DlqMonitorHandle {
  const intervalMs = deps.intervalMs ?? dlqMonitorIntervalFromEnv();
  const alertThreshold = deps.alertThreshold ?? DEFAULT_DLQ_ALERT_THRESHOLD;
  const connect = deps.connect ?? connectMq;
  const state = { prevDepth: 0 };

  let handle: MqHandle | null = null;
  let running = false;
  let stopped = false;

  const ensureChannel = async (): Promise<MqChannel | null> => {
    if (handle) return handle.channel;
    try {
      handle = await connect();
      await assertDlq(handle.channel);
      return handle.channel;
    } catch (err: unknown) {
      deps.logger.warn('dlq-monitor: falha ao conectar/garantir DLQ', {
        error: err instanceof Error ? err.message : String(err),
      });
      handle = null;
      return null;
    }
  };

  const tick = (): void => {
    if (running || stopped) return;
    running = true;
    void (async () => {
      const channel = await ensureChannel();
      if (!channel) return;
      const depth = await runDlqMonitorTick(channel, state, {
        logger: deps.logger,
        alertThreshold,
      });
      // Leitura falhou (canal possivelmente morto) — descarta o handle p/ reconectar.
      if (depth === null) {
        await handle?.connection.close().catch(() => undefined);
        handle = null;
      }
    })()
      .catch((err: unknown) => {
        deps.logger.error('dlq-monitor: tick falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  deps.logger.info('dlq-monitor iniciado', { intervalMs, alertThreshold });

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      const current = handle;
      handle = null;
      if (current) await current.connection.close().catch(() => undefined);
      deps.logger.info('dlq-monitor parado');
    },
  };
}
