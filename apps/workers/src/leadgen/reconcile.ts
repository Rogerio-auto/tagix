/**
 * Reconciliação de leads de anúncios (F69-S03).
 *
 * O webhook da Meta não é garantia de entrega: assinatura que caiu, deploy no minuto
 * errado, fila fora do ar. A reconciliação pergunta à Meta "que leads esta página
 * recebeu desde a última conferência?" e enfileira cada um. O processamento é
 * idempotente: lead que já chegou pelo webhook vira `duplicate` e não cria nada.
 *
 * - Singleton entre réplicas por trava no Redis (mesmo padrão dos outros agendadores).
 * - Primeira conferência de uma fonte olha as últimas 24h — o suficiente para pegar
 *   o que se perdeu entre a assinatura e o primeiro tick, sem varrer anos de leads.
 * - A janela anda com uma folga de 10 minutos para trás: lead criado durante a
 *   conferência anterior não cai no vão entre duas janelas.
 */
import { GraphClient } from '@hm/channels';
import { decryptSecret, leadAdsRepo, metaConnectionsRepo, withWorkspace, type ActiveLeadSource } from '@hm/db';
import { LEADGEN_EVENT_TYPE, LEADGEN_ROUTING_KEY, makeEnvelope, publish, type MqHandle } from '@hm/shared/mq';
import { acquireSchedulerLock, type RedisLike } from '../flows/scheduler';
import { GraphLeadSource } from './graph-source';
import type { LeadgenJob, LeadgenLogger } from './ports';

export const LEADGEN_RECONCILE_LOCK_KEY = 'hm:lock:leadgen-reconcile';
const LOCK_TTL_MS = 10 * 60 * 1000;
export const LEADGEN_RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
const PRIMEIRA_JANELA_MS = 24 * 60 * 60 * 1000;
const FOLGA_MS = 10 * 60 * 1000;

type MqChannel = MqHandle['channel'];

export interface ReconcilePorts {
  listActiveSources(): Promise<ActiveLeadSource[]>;
  tokenFor(source: ActiveLeadSource): Promise<string | null>;
  listLeadIdsSince(input: {
    connectionToken: string;
    pageId: string;
    since: Date;
  }): Promise<Array<{ leadgenId: string; formId: string; adId: string | null }>>;
  enqueue(job: LeadgenJob, workspaceId: string): Promise<void>;
  markReconciled(source: ActiveLeadSource, at: Date): Promise<void>;
}

export interface ReconcileResult {
  readonly ran: boolean;
  readonly sources: number;
  readonly enqueued: number;
  readonly failedSources: number;
}

/** Janela da conferência: desde a última (com folga) ou as últimas 24h na primeira. */
export function reconcileSince(lastReconciledAt: Date | null, now: Date): Date {
  if (lastReconciledAt === null) return new Date(now.getTime() - PRIMEIRA_JANELA_MS);
  return new Date(lastReconciledAt.getTime() - FOLGA_MS);
}

export async function runLeadgenReconcile(
  deps: { redis: RedisLike; ports: ReconcilePorts; logger: LeadgenLogger },
  now: Date = new Date(),
): Promise<ReconcileResult> {
  const release = await acquireSchedulerLock(deps.redis, LEADGEN_RECONCILE_LOCK_KEY, LOCK_TTL_MS);
  if (release === null) return { ran: false, sources: 0, enqueued: 0, failedSources: 0 };

  try {
    const fontes = await deps.ports.listActiveSources();
    let enfileirados = 0;
    let falhas = 0;
    for (const fonte of fontes) {
      try {
        const token = await deps.ports.tokenFor(fonte);
        if (token === null) {
          falhas += 1;
          deps.logger.warn('leadgen.reconcile.no_token', { workspaceId: fonte.workspaceId, pageId: fonte.pageId });
          continue;
        }
        const leads = await deps.ports.listLeadIdsSince({
          connectionToken: token,
          pageId: fonte.pageId,
          since: reconcileSince(fonte.lastReconciledAt, now),
        });
        for (const l of leads) {
          await deps.ports.enqueue(
            { leadgenId: l.leadgenId, pageId: fonte.pageId, formId: l.formId, adId: l.adId, origin: 'reconciliation' },
            fonte.workspaceId,
          );
          enfileirados += 1;
        }
        // Só avança a janela quando a conferência da fonte terminou inteira. Se falhar
        // no meio, a próxima rodada repete a mesma janela — duplicata é inofensiva,
        // buraco não.
        await deps.ports.markReconciled(fonte, now);
      } catch (err) {
        falhas += 1;
        deps.logger.error('leadgen.reconcile.source_failed', {
          workspaceId: fonte.workspaceId,
          pageId: fonte.pageId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { ran: true, sources: fontes.length, enqueued: enfileirados, failedSources: falhas };
  } finally {
    await release();
  }
}

export function createReconcilePorts(channel: MqChannel, graph: GraphClient = new GraphClient()): ReconcilePorts {
  const leitura = new GraphLeadSource(graph);
  return {
    listActiveSources: () => leadAdsRepo.listActiveSources(),
    tokenFor: (fonte) =>
      withWorkspace(fonte.workspaceId, async (tx) => {
        const c = await metaConnectionsRepo.getWithToken(tx, fonte.workspaceId, fonte.connectionId);
        if (c === null || c.status !== 'active' || c.accessTokenEnc === null) return null;
        return decryptSecret(c.accessTokenEnc, c.keyVersion);
      }),
    listLeadIdsSince: (input) => leitura.listLeadIdsSince(input),
    enqueue: async (job, workspaceId) => {
      // Backpressure do broker lança: a fonte não é marcada como conferida e a próxima
      // rodada repete a janela. Ignorar o `false` avançaria a janela por cima de um
      // lead que nunca entrou na fila.
      if (!publish(channel, LEADGEN_ROUTING_KEY, makeEnvelope(LEADGEN_EVENT_TYPE, workspaceId, job))) {
        throw new Error('leadgen: broker recusou o enfileiramento (backpressure).');
      }
      await Promise.resolve();
    },
    markReconciled: (fonte, at) =>
      withWorkspace(fonte.workspaceId, (tx) => leadAdsRepo.markReconciled(tx, fonte.workspaceId, fonte.sourceId, at)),
  };
}

export interface LeadgenReconcileHandle {
  stop(): Promise<void>;
}

export function startLeadgenReconcileScheduler(deps: {
  redis: RedisLike;
  channel: MqChannel;
  logger: LeadgenLogger;
  intervalMs?: number;
}): LeadgenReconcileHandle {
  const ports = createReconcilePorts(deps.channel);
  let rodando = false;
  const tick = (): void => {
    if (rodando) return;
    rodando = true;
    void runLeadgenReconcile({ redis: deps.redis, ports, logger: deps.logger })
      .then((r) => {
        if (r.ran && (r.enqueued > 0 || r.failedSources > 0)) deps.logger.info('leadgen.reconcile.tick', { ...r });
      })
      .catch((err: unknown) => {
        deps.logger.error('leadgen.reconcile.tick_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        rodando = false;
      });
  };
  const timer = setInterval(tick, deps.intervalMs ?? LEADGEN_RECONCILE_INTERVAL_MS);
  timer.unref?.();
  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      await Promise.resolve();
    },
  };
}
