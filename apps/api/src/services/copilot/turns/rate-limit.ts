/**
 * Limite de taxa do Copiloto por MEMBRO (COPILOTO.md P8, R5): 6 pedidos por minuto e 300 por
 * dia. É a defesa contra "a pessoa dispara 100 perguntas"; o loop do modelo é contido pelos
 * limites do turno e o custo pelo orçamento mensal.
 *
 * Por que não o `middlewares/rate-limit.ts`: aquele é de borda (chave IP+e-mail, janela fixa)
 * para as rotas de autenticação. Aqui a chave é o membro (o mesmo usuário em dois
 * dispositivos divide a cota) e a janela do minuto é DESLIZANTE: uma rajada na virada do
 * minuto não dobra o limite.
 *
 * Só pedido ACEITO consome cota. Quem bate no limite e tenta de novo a cada 10 s volta a
 * ser atendido quando a janela libera, em vez de ficar trancado para sempre.
 *
 * Tudo numa única chamada Lua (atômica): duas abas não passam juntas no 6º pedido.
 * Redis fora: deixa passar (o turno ativo único e o orçamento continuam valendo) e registra
 * a degradação no log.
 */
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import type { Logger } from '@hm/logger';
import { loadConfig } from '../../../config';

export const COPILOT_RATE_LIMITS = {
  perMinute: 6,
  perDay: 300,
} as const;

const MINUTE_MS = 60_000;
/** O contador do dia vive um pouco mais que o dia UTC (a chave já carrega a data). */
const DAY_KEY_TTL_S = 26 * 60 * 60;

export type CopilotRateDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly window: 'minute' | 'day';
      /** Quando tentar de novo, em segundos (≥ 1). */
      readonly retryAfterSec: number;
    };

export interface CopilotRateLimiter {
  consume(memberId: string, now?: Date): Promise<CopilotRateDecision>;
}

/**
 * KEYS[1] zset do minuto (score = ms do pedido); KEYS[2] contador do dia.
 * ARGV: agora (ms), janela (ms), limite/min, limite/dia, TTL do dia (s), id único do pedido.
 * Devolve { aceito(1|0), janela(0 ok|1 min|2 dia), espera (ms) }.
 */
const CONSUME_LUA = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, 1, tonumber(oldest[2]) + window - now}
end
local day = tonumber(redis.call('GET', KEYS[2]) or '0')
if day >= tonumber(ARGV[4]) then
  return {0, 2, redis.call('PTTL', KEYS[2])}
end
redis.call('ZADD', KEYS[1], now, ARGV[6])
redis.call('PEXPIRE', KEYS[1], window)
if redis.call('INCR', KEYS[2]) == 1 then
  redis.call('EXPIRE', KEYS[2], tonumber(ARGV[5]))
end
return {1, 0, 0}
`;

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '');
}

export interface RedisCopilotRateLimiterOptions {
  /** Cliente Redis (testes). Default: um cliente próprio, preguiçoso, de `REDIS_URL`. */
  readonly redis?: Redis;
  readonly logger?: Logger;
  readonly limits?: { readonly perMinute: number; readonly perDay: number };
  /** Prefixo das chaves (testes isolam por execução). */
  readonly keyPrefix?: string;
}

let sharedRedis: Redis | null = null;
function defaultRedis(): Redis {
  sharedRedis ??= new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  return sharedRedis;
}

/** Fecha o cliente compartilhado (teardown de teste). */
export async function closeCopilotRateLimiter(): Promise<void> {
  if (sharedRedis) {
    const client = sharedRedis;
    sharedRedis = null;
    await client.quit().catch(() => undefined);
  }
}

export function createRedisCopilotRateLimiter(
  options: RedisCopilotRateLimiterOptions = {},
): CopilotRateLimiter {
  const limits = options.limits ?? COPILOT_RATE_LIMITS;
  const prefix = options.keyPrefix ?? 'copilot:rl';
  return {
    async consume(memberId: string, now: Date = new Date()): Promise<CopilotRateDecision> {
      const nowMs = now.getTime();
      try {
        const redis = options.redis ?? defaultRedis();
        const raw: unknown = await redis.eval(
          CONSUME_LUA,
          2,
          `${prefix}:m:${memberId}`,
          `${prefix}:d:${memberId}:${dayKey(now)}`,
          String(nowMs),
          String(MINUTE_MS),
          String(limits.perMinute),
          String(limits.perDay),
          String(DAY_KEY_TTL_S),
          `${nowMs}-${randomBytes(6).toString('base64url')}`,
        );
        if (!Array.isArray(raw)) throw new Error('resposta inesperada do Redis');
        const [accepted, window, waitMs] = raw.map((v: unknown) => Number(v));
        if (accepted === 1) return { allowed: true };
        return {
          allowed: false,
          window: window === 2 ? 'day' : 'minute',
          retryAfterSec: Math.max(
            1,
            Math.ceil((Number.isFinite(waitMs) ? (waitMs ?? 0) : 0) / 1000),
          ),
        };
      } catch (err: unknown) {
        options.logger?.warn('copilot.rate_limit_degraded', {
          error: err instanceof Error ? err.name : 'unknown',
        });
        return { allowed: true };
      }
    },
  };
}
