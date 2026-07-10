/**
 * Scheduler do recompute de métricas de campanha (F56-S02). Singleton entre
 * instâncias via lock Redis (SET NX PX) — reusa `acquireSchedulerLock` do
 * scheduler de campanhas (mesmo padrão de F2-S21/F6-S05), com chave própria
 * (`hm:lock:scheduler:campaigns:recompute`) para não disputar com o tick de
 * envio. Cada tick (default 45s) roda `runCampaignMetricsRecompute` sob o lock;
 * erros não derrubam o scheduler (próximo tick recomeça).
 */
import {
  acquireSchedulerLock,
  type RedisLike,
} from '../scheduler';
import {
  runCampaignMetricsRecompute,
  type CampaignRecomputeDeps,
} from './job';

export const CAMPAIGN_RECOMPUTE_LOCK_KEY = 'hm:lock:scheduler:campaigns:recompute';
export const CAMPAIGN_RECOMPUTE_LOCK_TTL_MS = 40_000;
export const DEFAULT_CAMPAIGN_RECOMPUTE_MS = 45_000;

export interface CampaignRecomputeSchedulerDeps extends CampaignRecomputeDeps {
  readonly redis: RedisLike;
}

export interface CampaignRecomputeHandle {
  stop(): Promise<void>;
}

export interface CampaignRecomputeOptions {
  readonly intervalMs?: number;
}

/** Lê o intervalo do tick do ambiente (CAMPAIGN_RECOMPUTE_MS, default 45s). */
export function campaignRecomputeMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['CAMPAIGN_RECOMPUTE_MS'];
  if (raw === undefined || raw.length === 0) return DEFAULT_CAMPAIGN_RECOMPUTE_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CAMPAIGN_RECOMPUTE_MS;
}

/**
 * Roda um tick sob o lock de scheduler (singleton). Se outra instância detém o
 * lock, retorna sem tocar no DB. Libera o lock ao final (mesmo em erro).
 */
export async function runScheduledRecompute(
  deps: CampaignRecomputeSchedulerDeps,
): Promise<boolean> {
  const release = await acquireSchedulerLock(
    deps.redis,
    CAMPAIGN_RECOMPUTE_LOCK_KEY,
    CAMPAIGN_RECOMPUTE_LOCK_TTL_MS,
  );
  if (release === null) {
    deps.logger.debug('campaigns/recompute: tick pulado — lock detido por outra instância');
    return false;
  }
  try {
    await runCampaignMetricsRecompute({ ports: deps.ports, logger: deps.logger });
    return true;
  } finally {
    await release();
  }
}

/** Inicia o scheduler: dispara `runScheduledRecompute` a cada `intervalMs`. */
export function startCampaignRecomputeScheduler(
  deps: CampaignRecomputeSchedulerDeps,
  options: CampaignRecomputeOptions = {},
): CampaignRecomputeHandle {
  const intervalMs = options.intervalMs ?? campaignRecomputeMsFromEnv();
  let running = false;

  const tick = (): void => {
    if (running) {
      deps.logger.debug('campaigns/recompute: tick anterior ainda em execução — disparo pulado');
      return;
    }
    running = true;
    void runScheduledRecompute(deps)
      .catch((err: unknown) => {
        deps.logger.error('campaigns/recompute: tick falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  deps.logger.info('campaigns/recompute scheduler iniciado', { intervalMs });

  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      deps.logger.info('campaigns/recompute scheduler parado');
      await Promise.resolve();
    },
  };
}
