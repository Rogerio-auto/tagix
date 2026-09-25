import type { Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { getDb } from '@hm/db';
import { connectMq, getMqHealth, type ResilientMqHandle } from '@hm/shared/mq';
import {
  classifyStorageError,
  createStorage,
  isStorageProbe,
  probeStateFromError,
  type IStorageDriver,
  type StorageProbeResult,
  type StorageProbeState,
} from '@hm/storage';
import { createLogger } from '@hm/logger';
import { loadConfig } from './config';
import { Gauge, getMetricsRegistry } from './middlewares/metrics';

let redis: Redis | null = null;
function getRedis(): Redis {
  redis ??= new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  return redis;
}

/**
 * Timeout curto do probe AMQP. O `/health` é chamado por orquestradores
 * (Docker/Swarm) com deadline apertado — um broker que aceita o TCP mas não
 * completa o handshake não pode PENDURAR o handler. `connect()` do amqplib não
 * tem timeout próprio, então corremos contra este relógio.
 */
const MQ_PROBE_TIMEOUT_MS = 2_000;

/** Probe dedicado, aberto no máximo uma vez (fallback quando o processo ainda
 *  não tem nenhuma conexão AMQP gerenciada própria). */
let mqProbe: ResilientMqHandle | null = null;
/** Deduplica probes concorrentes durante o bootstrap. */
let mqProbePromise: Promise<ResilientMqHandle> | null = null;

/** Conecta ao broker com teto de tempo; fecha o socket órfão se resolver tarde. */
function connectMqWithTimeout(ms: number): Promise<ResilientMqHandle> {
  const probe = connectMq(undefined, {
    // Probe leve: reconecta em background sem afogar o broker durante uma queda.
    reconnect: { initialDelayMs: 1_000, maxDelayMs: 30_000 },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('mq health probe timeout')), ms);
    timer.unref?.();
  });
  return Promise.race([probe, timeout])
    .catch((err: unknown) => {
      // Se a conexão resolver DEPOIS do timeout, fecha para não vazar socket.
      void probe.then((h) => h.close()).catch(() => undefined);
      throw err;
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
}

// ─── Storage (F61-S11 → F70-S27) ──────────────────────────────────────────────
//
// Por que existe: em 2026-09-09 e de novo em 2026-09-25 o token do R2 foi recusado e
// a plataforma seguiu respondendo 200. Nenhuma mídia subia, nenhuma signed URL abria,
// e a primeira notícia veio de um print de cliente. Um serviço que não sabe dizer que
// perdeu o storage não está saudável — está calado.
//
// A sonda é um `HeadBucket` (F70-S27): toca a rede e valida a credencial contra o
// bucket sem gravar objeto. Assinar URL não serve (é operação local e passa com
// credencial morta). O resultado distingue `denied` (o storage respondeu e recusou:
// falha de configuração, só uma pessoa resolve) de `unreachable` (não respondeu).
// Driver sem sonda própria cai no `put` antigo.
const STORAGE_PROBE_KEY = '_health/probe' as const;
const storageLogger = createLogger('info', { svc: '@hm/api' });
/**
 * Teto de tempo da sonda.
 *
 * Generoso porque ela roda em SEGUNDO PLANO e nunca segura a resposta: a primeira
 * chamada do processo paga a inicialização do cliente S3 (resolução de região, cadeia
 * de credenciais) — com o teto antigo de 3s, reportava `down` para um storage vivo.
 */
const STORAGE_PROBE_TIMEOUT_MS = 15_000;
/**
 * O resultado vale por um minuto. `/health` é chamado a cada poucos segundos pelo
 * Swarm; um round-trip a cada chamada seria desperdício de rede e de cota — e a
 * credencial não muda de estado entre dois segundos.
 */
const STORAGE_PROBE_TTL_MS = 60_000;

/**
 * Estado do storage no `/health`:
 *  - `ok`          — respondeu e aceitou a credencial;
 *  - `denied`      — respondeu e RECUSOU (credencial revogada/expirada/sem escopo,
 *                    bucket inexistente) — o caso dos dois incidentes;
 *  - `unreachable` — não respondeu a tempo, ou respondeu com erro transitório;
 *  - `checking`    — ainda não medimos (container recém-subido). Reportar `ok` sem
 *                    medir seria um falso "está tudo bem"; `denied`, um falso alarme a
 *                    cada reinício.
 */
export type StorageHealthState = StorageProbeState | 'checking';

const STORAGE_STATES: readonly StorageHealthState[] = ['ok', 'denied', 'unreachable', 'checking'];

/**
 * `hm_storage_state{state}` — um-quente (1 no estado atual, 0 nos demais). A regra
 * `LeadiumStorageDenied` (`infra/prometheus/alerts.yml`) dispara em `state="denied"`.
 */
const storageStateGauge = new Gauge({
  name: 'hm_storage_state',
  help: 'Estado do storage de objetos visto pela sonda do /health (1 = estado atual).',
  labelNames: ['state'] as const,
  registers: [getMetricsRegistry()],
});

function publishStorageState(state: StorageHealthState): void {
  for (const s of STORAGE_STATES) storageStateGauge.set({ state: s }, s === state ? 1 : 0);
}
publishStorageState('checking');

let storageProbe: { at: number; state: StorageHealthState } | null = null;
/** Só loga na TRANSIÇÃO — alarme que repete a cada minuto vira ruído e é ignorado. */
let storageLastLogged: StorageHealthState | null = null;
/** Sonda em voo — evita disparar dez sondagens enquanto a primeira não voltou. */
let storageEmVoo: Promise<void> | null = null;

/** Cliente memoizado: criar um S3Client por sondagem paga a inicialização toda vez. */
let storageClient: ReturnType<typeof createStorage> | null = null;
function getStorage(): ReturnType<typeof createStorage> {
  storageClient ??= createStorage();
  return storageClient;
}

/** `put` com teto de tempo — só para driver sem sonda própria. */
async function probeByPut(driver: IStorageDriver): Promise<StorageProbeResult> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      driver
        .put({ key: STORAGE_PROBE_KEY, body: Buffer.from('ok'), contentType: 'text/plain' })
        .then((): StorageProbeResult => ({ state: 'ok', durationMs: Date.now() - started })),
      new Promise<StorageProbeResult>((resolve) => {
        timer = setTimeout(() => {
          resolve({ state: 'unreachable', code: 'TimeoutError', durationMs: Date.now() - started });
        }, STORAGE_PROBE_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } catch (err: unknown) {
    return { ...probeStateFromError(err), durationMs: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Executa a sondagem de verdade e guarda o resultado. Nunca lança. */
async function sondarStorage(): Promise<void> {
  let result: StorageProbeResult;
  try {
    const driver = getStorage();
    result = isStorageProbe(driver)
      ? await driver.probe(STORAGE_PROBE_TIMEOUT_MS)
      : await probeByPut(driver);
  } catch (err: unknown) {
    // Nem montar o driver deu (variável de ambiente ausente): é configuração.
    result = { state: 'denied', code: classifyStorageError(err).code, durationMs: 0 };
  }

  storageProbe = { at: Date.now(), state: result.state };
  publishStorageState(result.state);
  if (result.state !== storageLastLogged) {
    storageLastLogged = result.state;
    const fields = {
      storageState: result.state,
      storageCode: result.code,
      durationMs: result.durationMs,
      bucket: process.env['R2_BUCKET'],
    };
    if (result.state === 'denied') {
      storageLogger.error(
        'storage recusou a credencial: mídia não sobe e signed URL não abre — troque o token do bucket (runbook storage-recusou-midia)',
        fields,
      );
    } else if (result.state === 'unreachable') {
      storageLogger.warn('storage não respondeu à sondagem', fields);
    } else {
      storageLogger.info('storage acessível', fields);
    }
  }
}

/**
 * Estado do storage para o `/health`, **sem nunca segurar a resposta**: sondado em
 * segundo plano; o handler devolve o último resultado conhecido, na hora. O storage é
 * informação, não dependência de disponibilidade (ver `healthHandler`).
 */
function checkStorage(): StorageHealthState {
  const agora = Date.now();
  const vencido = storageProbe === null || agora - storageProbe.at >= STORAGE_PROBE_TTL_MS;

  if (vencido && storageEmVoo === null) {
    storageEmVoo = sondarStorage().finally(() => {
      storageEmVoo = null;
    });
    storageEmVoo.catch(() => undefined);
  }

  return storageProbe?.state ?? 'checking';
}

/** Zera o cache da sonda de storage (testes). */
export function resetStorageProbe(): void {
  storageProbe = null;
  storageLastLogged = null;
  storageEmVoo = null;
  storageClient = null;
  publishStorageState('checking');
}

/** Aguarda a sondagem em voo. Só para teste — o handler nunca espera. */
export async function awaitStorageProbe(): Promise<void> {
  if (storageEmVoo !== null) await storageEmVoo;
}

/**
 * Estado do RabbitMQ para o `/health`.
 *
 * Reusa PRIMEIRO as conexões AMQP já gerenciadas pelo processo (o relay
 * consumer e o publisher outbound abrem `connectMq`, que se registra no
 * `getMqHealth()` agregado) — checagem gratuita, sem abrir socket novo, e que
 * reflete a mesma conexão que carrega as mensagens de verdade. Só quando o
 * processo ainda não tem NENHUMA conexão gerenciada é que abrimos um probe
 * dedicado e leve (com timeout curto, sem publicar nada).
 */
async function checkMq(): Promise<'connected' | 'down'> {
  const health = getMqHealth();
  if (health.connections.length > 0) {
    return health.healthy ? 'connected' : 'down';
  }
  // Sem conexão gerenciada própria → abre (uma vez) um probe dedicado.
  if (!mqProbe) {
    try {
      mqProbePromise ??= connectMqWithTimeout(MQ_PROBE_TIMEOUT_MS);
      mqProbe = await mqProbePromise;
    } catch {
      return 'down';
    } finally {
      mqProbePromise = null;
    }
  }
  return mqProbe.isConnected() ? 'connected' : 'down';
}

/** Encerra os clientes de saúde (testes / shutdown). */
export async function closeHealth(): Promise<void> {
  resetStorageProbe();
  if (redis) {
    await redis.quit();
    redis = null;
  }
  if (mqProbe) {
    try {
      await mqProbe.close();
    } catch {
      // já caiu — nada a fazer
    }
    mqProbe = null;
  }
  mqProbePromise = null;
}

/** GET /health — verifica dependências de verdade (não só 200). */
export async function healthHandler(_req: Request, res: Response): Promise<void> {
  let db = 'down';
  let cache = 'down';
  let mq = 'down';
  let storage: StorageHealthState = 'checking';
  try {
    await getDb().execute(sql`select 1`);
    db = 'connected';
  } catch {
    // db indisponível
  }
  try {
    if ((await getRedis().ping()) === 'PONG') cache = 'connected';
  } catch {
    // redis indisponível
  }
  try {
    mq = await checkMq();
  } catch {
    // broker indisponível
  }
  try {
    storage = checkStorage();
  } catch {
    // Nem a leitura do último resultado pode derrubar o handler.
  }
  // Storage NÃO derruba o `/health` de propósito: 503 tira a API de rotação, e
  // uma plataforma inteira fora do ar é pior que mídia que não carrega. O texto e
  // o alarme dizem a verdade; a decisão de reciclar o container não muda.
  const healthy = db === 'connected' && cache === 'connected' && mq === 'connected';
  res.status(healthy ? 200 : 503).json({
    // `checking` não degrada: ainda não há motivo para alarme, e um container
    // recém-subido não pode parecer doente pelos primeiros segundos de vida.
    status: healthy ? (storage === 'denied' || storage === 'unreachable' ? 'degraded' : 'ok') : 'degraded',
    db,
    redis: cache,
    rabbitmq: mq,
    storage,
  });
}
