/**
 * Rate-limit de borda + auditoria de auth + verificação de captcha (F44-S03).
 *
 * Protege os endpoints de auth (login/signup/reset/verify) contra brute-force,
 * mass-signup e credential-stuffing (T4). Store no Redis existente (fixed-window
 * por chave IP[+email]). Fail-open controlado: se o Redis cair, NÃO derruba o
 * login — mas o evento é auditável (T10).
 *
 * Também expõe:
 *  - `verifyTurnstile()` — verificação server-side do Cloudflare Turnstile (T4).
 *  - `auditAuthEvent()` — trilha de signup/login-falho/reset em `audit_logs` (T10).
 *
 * Nenhuma senha trafega por aqui; a chave de rate-limit usa só IP + email.
 */
import { createHash } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import Redis from 'ioredis';
import { getDb, schema } from '@hm/db';
import { loadConfig } from '../config';

let redis: Redis | null = null;
function client(): Redis {
  redis ??= new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  return redis;
}

/** Fecha a conexão (paridade com closeCache; usado em teardown de teste). */
export async function closeRateLimit(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

/**
 * IP do cliente. Express resolve via `trust proxy` (configurado em `app.ts`): só o
 * hop que o Traefik adiciona é confiável. NUNCA usar o 1º elemento do
 * `X-Forwarded-For` — ele é controlado pelo cliente e seria spoofável, burlando o
 * rate-limit (cada request com um XFF diferente viraria uma chave Redis nova).
 */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** Hash curto e estável de um identificador (não guarda email em claro na key). */
function keyPart(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 16);
}

export interface RateLimitOptions {
  /** Prefixo lógico da rota (ex.: 'login', 'signup'). */
  readonly bucket: string;
  /** Máximo de hits permitidos na janela. */
  readonly max: number;
  /** Janela em segundos. */
  readonly windowSec: number;
  /**
   * Inclui o email do body na chave (IP+email). Default true: combina o ataque por
   * IP e por conta. Para verify (sem email no body) deixe false.
   */
  readonly byEmail?: boolean;
}

interface RateLimitState {
  readonly count: number;
  readonly ttlSec: number;
}

/** Incrementa o contador da janela e devolve o estado. Lança se o Redis falhar. */
async function hit(redisKey: string, windowSec: number): Promise<RateLimitState> {
  const c = client();
  const count = await c.incr(redisKey);
  if (count === 1) {
    await c.expire(redisKey, windowSec);
  }
  const ttl = await c.ttl(redisKey);
  return { count, ttlSec: ttl >= 0 ? ttl : windowSec };
}

function extractEmail(req: Request): string | null {
  const body: unknown = req.body;
  if (body && typeof body === 'object' && 'email' in body) {
    const email = (body as { email: unknown }).email;
    if (typeof email === 'string' && email.length > 0) return email;
  }
  return null;
}

/**
 * Middleware de rate-limit. Em estouro responde 429 com shape de erro padrão
 * (UX §2.11) — sem revelar a contagem exata. Em falha de Redis, fail-open (deixa
 * passar) mas registra a degradação no log (T10).
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const byEmail = options.byEmail ?? true;
  return (req: Request, res: Response, next: NextFunction): void => {
    const parts = [options.bucket, keyPart(clientIp(req))];
    if (byEmail) {
      const email = extractEmail(req);
      if (email) parts.push(keyPart(email));
    }
    const redisKey = `rl:${parts.join(':')}`;

    hit(redisKey, options.windowSec)
      .then((state) => {
        if (state.count > options.max) {
          res.setHeader('Retry-After', String(state.ttlSec));
          res.status(429).json({
            message: 'Muitas tentativas. Aguarde alguns instantes e tente de novo.',
            reason: 'rate_limited',
          });
          return;
        }
        next();
      })
      .catch((err: unknown) => {
        // Fail-open: indisponibilidade do Redis não pode trancar o login legítimo.
        // Mas registra a degradação para detecção (T10).
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'rate_limit_degraded',
            bucket: options.bucket,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        next();
      });
  };
}

// ─── Auditoria de auth ───────────────────────────────────────────────────────

export type AuthAuditAction =
  | 'auth.signup'
  | 'auth.login_failed'
  | 'auth.reset_requested'
  | 'auth.reset_confirmed'
  | 'auth.verify';

/**
 * Registra um evento de auth em `audit_logs` (best-effort, nunca quebra o request).
 * `workspace_id`/`actor_member_id` ficam nulos (pré-sessão); o email vai em metadata
 * (jsonb), nunca a senha (T6). actor_type='system' (evento de borda sem membro).
 */
export async function auditAuthEvent(
  action: AuthAuditAction,
  req: Request,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const ua = req.headers['user-agent'];
    await getDb()
      .insert(schema.auditLogs)
      .values({
        actorType: 'system',
        action,
        resourceType: 'auth',
        metadata,
        ipAddress: clientIp(req),
        userAgent: typeof ua === 'string' ? ua.slice(0, 512) : null,
      });
  } catch {
    // Auditoria é best-effort; jamais derruba o fluxo de auth.
  }
}

// ─── Cloudflare Turnstile ────────────────────────────────────────────────────

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Verifica o token do Turnstile server-side com o secret de env
 * (`TURNSTILE_SECRET_KEY`). NUNCA expõe o secret ao cliente.
 *
 * Sem secret configurado: em produção FALHA (nega — fail-closed); fora de produção
 * permite explicitamente (dev sem captcha), logando o bypass. Token vazio sempre falha.
 */
export async function verifyTurnstile(token: string, remoteIp?: string): Promise<boolean> {
  const secret = process.env['TURNSTILE_SECRET_KEY'];
  const isProd = process.env['NODE_ENV'] === 'production';

  if (!secret) {
    if (isProd) return false; // fail-closed em produção
    console.warn(
      JSON.stringify({ level: 'warn', event: 'turnstile_dev_bypass', reason: 'no_secret' }),
    );
    return true; // dev: sem captcha configurado, não bloqueia o fluxo local
  }
  if (!token) return false;

  try {
    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', token);
    if (remoteIp) form.set('remoteip', remoteIp);

    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as TurnstileVerifyResponse;
    return data.success === true;
  } catch {
    return false; // erro de rede → trata como falha de verificação (fail-closed)
  }
}
