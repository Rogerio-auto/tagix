/**
 * Scheduler do worker-campaigns (CAMPAIGNS.md 8.1). Singleton entre instancias
 * via lock Redis (SET NX PX + token), espelhando o followup scheduler de F2-S21.
 *
 * F58-S11:
 *  - varredura a cada 5s (antes 60s): o compasso das campanhas (GCRA em
 *    rate.ts) distribui os envios ao longo do minuto; uma varredura de 60s
 *    obrigaria a mandar o minuto inteiro de uma vez (rajada) ou a perder vazao;
 *  - o lock e RENOVADO enquanto o tick roda (heartbeat a cada TTL/3, Lua que so
 *    estende se o token ainda e nosso). Se a renovacao falha — Redis caiu, ou o
 *    lock expirou e outra instancia assumiu — o tick recebe `abort` e nao comeca
 *    campanha nem mensagem nova. Mesmo nesse caso nao ha trabalho duplicado: a
 *    reserva de ritmo/cota e o claim do recipient sao atomicos no Postgres.
 */
import { runCampaignTick, type CampaignTickDeps } from './tick';
import { DEFAULT_PACING_WINDOW_MS } from './rate';

export const CAMPAIGN_SCHEDULER_LOCK_KEY = 'hm:lock:scheduler:campaigns';
/** TTL do lock do scheduler. Renovado a cada TTL/3 enquanto o tick roda. */
export const CAMPAIGN_SCHEDULER_LOCK_TTL_MS = 30000;
/** Intervalo padrao da varredura (casa com a janela de compasso). */
export const DEFAULT_CAMPAIGN_TICK_MS = DEFAULT_PACING_WINDOW_MS;

/** Subconjunto de ioredis usado pelo lock de scheduler (mockavel). */
export interface RedisLike {
  set(key: string, value: string, mode: 'PX', ttlMs: number, cond: 'NX'): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

const UNLOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** Estende o TTL so se o token ainda e o nosso (nunca rouba lock alheio). */
const RENEW_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

export type ReleaseLock = () => Promise<void>;

/** Lock adquirido: liberar + renovar. */
export interface SchedulerLease {
  readonly release: ReleaseLock;
  /** true = TTL estendido; false = o lock nao e mais nosso (ou Redis falhou). */
  readonly renew: () => Promise<boolean>;
}

function newToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Adquire o lock com renovacao. `null` = outra instancia detem o lock. */
export async function acquireSchedulerLease(
  redis: RedisLike,
  key: string,
  ttlMs: number,
): Promise<SchedulerLease | null> {
  const token = newToken();
  const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      await redis.eval(UNLOCK_LUA, 1, key, token);
    },
    renew: async () => {
      if (released) return false;
      try {
        const res = await redis.eval(RENEW_LUA, 1, key, token, String(ttlMs));
        return res === 1 || res === '1';
      } catch {
        return false;
      }
    },
  };
}

/** Compat: aquisicao sem renovacao (mesma semantica de antes). */
export async function acquireSchedulerLock(
  redis: RedisLike,
  key: string,
  ttlMs: number,
): Promise<ReleaseLock | null> {
  const lease = await acquireSchedulerLease(redis, key, ttlMs);
  return lease === null ? null : lease.release;
}

/** Temporizador injetavel (testes controlam o heartbeat sem relogio real). */
export interface HeartbeatTimer {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const realTimer: HeartbeatTimer = {
  setInterval: (fn, ms) => {
    const h = setInterval(fn, ms);
    h.unref?.();
    return h;
  },
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export interface CampaignSchedulerDeps extends CampaignTickDeps {
  readonly redis: RedisLike;
  /** Default: timers reais. */
  readonly timer?: HeartbeatTimer;
}

export interface CampaignSchedulerHandle {
  stop(): Promise<void>;
}

export interface CampaignSchedulerOptions {
  readonly intervalMs?: number;
}

export interface ScheduledTickOptions {
  readonly now?: Date;
  /** Janela de compasso; default = intervalo padrao da varredura. */
  readonly pacingWindowMs?: number;
}

/** Le o intervalo do tick do ambiente (CAMPAIGN_TICK_MS, default 5s). */
export function campaignTickMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['CAMPAIGN_TICK_MS'];
  if (raw === undefined || raw.length === 0) return DEFAULT_CAMPAIGN_TICK_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CAMPAIGN_TICK_MS;
}

/**
 * Roda um tick sob o lock de scheduler (singleton), renovando o lock enquanto
 * roda. Se outra instancia detem o lock, retorna sem tocar no DB. Libera o lock
 * ao final (mesmo em erro).
 */
export async function runScheduledCampaignTick(
  deps: CampaignSchedulerDeps,
  options: ScheduledTickOptions = {},
): Promise<boolean> {
  const lease = await acquireSchedulerLease(
    deps.redis,
    CAMPAIGN_SCHEDULER_LOCK_KEY,
    CAMPAIGN_SCHEDULER_LOCK_TTL_MS,
  );
  if (lease === null) {
    deps.logger.debug('campaigns: tick pulado — lock detido por outra instancia');
    return false;
  }

  const timer = deps.timer ?? realTimer;
  const leadership = new AbortController();
  const heartbeat = timer.setInterval(
    () => {
      void lease.renew().then((ok) => {
        if (!ok && !leadership.signal.aborted) {
          deps.logger.warn('campaigns: lock do scheduler nao renovou — abortando o tick');
          leadership.abort();
        }
      });
    },
    Math.floor(CAMPAIGN_SCHEDULER_LOCK_TTL_MS / 3),
  );

  try {
    await runCampaignTick(
      { ports: deps.ports, logger: deps.logger },
      {
        now: options.now,
        pacingWindowMs: options.pacingWindowMs,
        signal: leadership.signal,
      },
    );
    return true;
  } finally {
    timer.clearInterval(heartbeat);
    await lease.release();
  }
}

/** Inicia o scheduler: dispara runScheduledCampaignTick a cada intervalMs. */
export function startCampaignScheduler(
  deps: CampaignSchedulerDeps,
  options: CampaignSchedulerOptions = {},
): CampaignSchedulerHandle {
  const intervalMs = options.intervalMs ?? campaignTickMsFromEnv();
  // O balde precisa cobrir o intervalo entre varreduras (senao a vazao cai).
  const pacingWindowMs = Math.max(intervalMs, DEFAULT_PACING_WINDOW_MS);
  let running = false;

  const tick = (): void => {
    if (running) {
      deps.logger.debug('campaigns: tick anterior ainda em execucao — disparo pulado');
      return;
    }
    running = true;
    void runScheduledCampaignTick(deps, { pacingWindowMs })
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
  deps.logger.info('campaigns scheduler iniciado', { intervalMs, pacingWindowMs });

  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      deps.logger.info('campaigns scheduler parado');
      await Promise.resolve();
    },
  };
}
