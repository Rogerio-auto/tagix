/**
 * Gate progressivo de captcha no login (SEC-05, F56-S06).
 *
 * O rate-limit IP+email não barra credential spraying (1 IP × N emails = N chaves
 * novas). Este módulo conta FALHAS de login por IP numa janela fixa no Redis; ao
 * cruzar o limiar, o login daquele IP passa a exigir Turnstile (verificado
 * server-side, reuso do `verifyTurnstile` do signup). Usuário legítimo nunca vê
 * captcha (falhas esporádicas ficam abaixo do limiar e expiram com a janela).
 *
 * Fail-open consciente (mesma filosofia do rate-limit): Redis indisponível não
 * pode trancar login legítimo — o gate desarma e o evento fica auditável no log.
 * A chave usa hash do IP (não guarda IP em claro no Redis).
 */
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { loadConfig } from '../config';

/** Falhas de login por IP na janela que armam o captcha. */
export const LOGIN_CAPTCHA_THRESHOLD = 10;
/** Janela da contagem de falhas (alinhada à janela do limiter IP+email). */
export const LOGIN_CAPTCHA_WINDOW_SEC = 15 * 60;

let redis: Redis | null = null;
function client(): Redis {
  redis ??= new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  return redis;
}

/** Fecha a conexão (paridade com closeRateLimit; teardown de teste). */
export async function closeLoginCaptcha(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

function failureKey(ip: string): string {
  const h = createHash('sha256').update(ip.trim().toLowerCase()).digest('hex').slice(0, 16);
  return `auth:loginfail:${h}`;
}

/** Registra uma falha de login do IP (best-effort; nunca quebra o request). */
export async function recordLoginFailure(ip: string): Promise<void> {
  try {
    const key = failureKey(ip);
    const count = await client().incr(key);
    if (count === 1) await client().expire(key, LOGIN_CAPTCHA_WINDOW_SEC);
  } catch (err) {
    warnDegraded('record', err);
  }
}

/** O IP acumulou falhas suficientes na janela para exigir captcha? */
export async function loginCaptchaRequired(ip: string): Promise<boolean> {
  try {
    const raw = await client().get(failureKey(ip));
    return raw !== null && Number(raw) >= LOGIN_CAPTCHA_THRESHOLD;
  } catch (err) {
    warnDegraded('check', err); // fail-open: Redis off não tranca login legítimo
    return false;
  }
}

function warnDegraded(op: string, err: unknown): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'login_captcha_degraded',
      op,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}
