/**
 * Gate da API pública v1 (F9-S02).
 *
 * - `requireApiKey` — extrai `Authorization: Bearer hm_...`, resolve a chave (SHA-256
 *   → lookup ativo/não-expirado/não-revogado), injeta `req.apiAuth`, atualiza
 *   `last_used_at` (best-effort) e aplica **rate limit por chave** via Redis (sliding
 *   window de 60s). Emite headers `X-RateLimit-*` e responde 429 ao estourar.
 * - `requireScope(scope)` — autorização fina; 403 se o scope não estiver na chave.
 *
 * O middleware NÃO popula `req.scoped` à moda da sessão de membro; cada handler v1
 * usa `withWorkspace(req.apiAuth.workspaceId, ...)` explicitamente (S03), mantendo o
 * isolamento RLS sob o tenant da chave.
 */
import type { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';
import { loadConfig } from '../config';
import {
  extractBearerToken,
  lookupApiKey,
  touchApiKeyLastUsed,
  type ApiKeyAuth,
} from '../services/api-keys';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Contexto autenticado por API key (F9). Presente após `requireApiKey`. */
      apiAuth?: ApiKeyAuth;
    }
  }
}

/** Janela do rate limit, em segundos. `rate_limit_per_minute` é por esta janela. */
const WINDOW_SECONDS = 60;

let redis: Redis | null = null;
function client(): Redis {
  redis ??= new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  return redis;
}

/** Encerra a conexão Redis do rate limiter (testes / shutdown). */
export async function closeApiKeyRateLimiter(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

interface RateResult {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Epoch (segundos) em que a janela atual zera. */
  readonly resetAt: number;
}

/**
 * Fixed-window counter por chave (granularidade de 60s). `INCR` cria o contador e o
 * `EXPIRE` (só na 1ª incidência) garante o reset. Atômico via pipeline.
 *
 * Fail-open: se o Redis estiver indisponível, NÃO bloqueia a request (a indisponibilidade
 * do limitador não deve derrubar a API). Trade-off consciente — disponibilidade > enforcement
 * estrito numa falha de infra; o caminho de DB/auth permanece protegido.
 */
async function consumeRateLimit(keyId: string, limit: number): Promise<RateResult> {
  const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
  const redisKey = `ratelimit:apikey:${keyId}:${window}`;
  const resetAt = (window + 1) * WINDOW_SECONDS;
  try {
    const [[, countRaw]] = (await client()
      .multi()
      .incr(redisKey)
      .expire(redisKey, WINDOW_SECONDS)
      .exec()) as [[Error | null, number], [Error | null, number]];
    const count = Number(countRaw);
    const remaining = Math.max(0, limit - count);
    return { allowed: count <= limit, limit, remaining, resetAt };
  } catch {
    // Redis off → fail-open. Reporta a janela cheia como "remaining" para não enganar.
    return { allowed: true, limit, remaining: limit, resetAt };
  }
}

/** Exige uma API key válida; injeta `req.apiAuth` e aplica rate limit por chave. */
export async function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res
      .status(401)
      .json({ error: 'unauthorized', message: 'API key ausente ou malformada (Bearer hm_...).' });
    return;
  }

  const auth = await lookupApiKey(token);
  if (!auth) {
    res
      .status(401)
      .json({ error: 'unauthorized', message: 'API key inválida, expirada ou revogada.' });
    return;
  }

  const rate = await consumeRateLimit(auth.keyId, auth.rateLimitPerMinute);
  res.setHeader('X-RateLimit-Limit', String(rate.limit));
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
  res.setHeader('X-RateLimit-Reset', String(rate.resetAt));
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(Math.max(1, rate.resetAt - Math.floor(Date.now() / 1000))));
    res.status(429).json({
      error: 'rate_limited',
      message: 'Limite de requisições por minuto excedido para esta API key.',
    });
    return;
  }

  req.apiAuth = auth;
  // Telemetria de uso — best-effort, não aguarda nem bloqueia a request.
  void touchApiKeyLastUsed(auth.keyId);
  next();
}

/** Autoriza pela presença do scope na chave. Usar SEMPRE após `requireApiKey`. */
export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const scopes = req.apiAuth?.scopes;
    if (!scopes) {
      res.status(401).json({ error: 'unauthorized', message: 'API key não autenticada.' });
      return;
    }
    if (!scopes.includes(scope)) {
      res
        .status(403)
        .json({ error: 'forbidden', message: `API key sem o scope necessário: ${scope}.` });
      return;
    }
    next();
  };
}
