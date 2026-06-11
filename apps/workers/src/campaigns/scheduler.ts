/**
 * Scheduler do worker-campaigns (CAMPAIGNS.md 8.1). Singleton entre instancias
 * via lock Redis (SET NX PX), espelhando o followup scheduler de F2-S21. Cada
 * tick (default 60s) chama runCampaignTick sob o lock hm:lock:scheduler:campaigns;
 * so a instancia vencedora roda. Erros nao derrubam o scheduler (proximo tick
 * recomeca). O tick em si serializa por campanha via runWithDistributedLock.
 */
import { runCampaignTick, type CampaignTickDeps } from './tick';

export const CAMPAIGN_SCHEDULER_LOCK_KEY = 'hm:lock:scheduler:campaigns';
export const CAMPAIGN_SCHEDULER_LOCK_TTL_MS = 50000;
export const DEFAULT_CAMPAIGN_TICK_MS = 60000;

/** Subconjunto de ioredis usado pelo lock de scheduler (mockavel). */
export interface RedisLike {
  set(key: string, value: string, mode: 'PX', ttlMs: number, cond: 'NX'): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

const UNLOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export type ReleaseLock = () => Promise<void>;

export async function acquireSchedulerLock(
  redis: RedisLike,
  key: string,
  ttlMs: number,
): Promise<ReleaseLock | null> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await redis.eval(UNLOCK_LUA, 1, key, token);
  };
}

export interface CampaignSchedulerDeps extends CampaignTickDeps {
  readonly redis: RedisLike;
}

export interface CampaignSchedulerHandle {
  stop(): Promise<void>;
}

export interface CampaignSchedulerOptions {
  readonly intervalMs?: number;
}

/** Le o intervalo do tick do ambiente (CAMPAIGN_TICK_MS, default 60s). */
export function campaignTickMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['CAMPAIGN_TICK_MS'];
  if (raw === undefined || raw.length === 0) return DEFAULT_CAMPAIGN_TICK_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CAMPAIGN_TICK_MS;
}

/**
 * Roda um tick sob o lock de scheduler (singleton). Se outra instancia detem o
 * lock, retorna sem tocar no DB. Libera o lock ao final (mesmo em erro).
 */
export async function runScheduledCampaignTick(deps: CampaignSchedulerDeps): Promise<boolean> {
  const release = await acquireSchedulerLock(
    deps.redis,
    CAMPAIGN_SCHEDULER_LOCK_KEY,
    CAMPAIGN_SCHEDULER_LOCK_TTL_MS,
  );
  if (release === null) {
    deps.logger.debug('campaigns: tick pulado — lock detido por outra instancia');
    return false;
  }
  try {
    await runCampaignTick({ ports: deps.ports, logger: deps.logger });
    return true;
  } finally {
    await release();
  }
}

/** Inicia o scheduler: dispara runScheduledCampaignTick a cada intervalMs. */
export function startCampaignScheduler(
  deps: CampaignSchedulerDeps,
  options: CampaignSchedulerOptions = {},
): CampaignSchedulerHandle {
  const intervalMs = options.intervalMs ?? campaignTickMsFromEnv();
  let running = false;

  const tick = (): void => {
    if (running) {
      deps.logger.debug('campaigns: tick anterior ainda em execucao — disparo pulado');
      return;
    }
    running = true;
    void runScheduledCampaignTick(deps)
      .catch((err: unknown) => {
        deps.logger.error('campaigns: tick falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  deps.logger.info('campaigns scheduler iniciado', { intervalMs });

  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      deps.logger.info('campaigns scheduler parado');
      await Promise.resolve();
    },
  };
}
