import * as Sentry from '@sentry/node';

/**
 * Sentry **opt-in** para os workers. No-op completo sem `SENTRY_DSN_WORKERS`.
 * Idempotente. O orchestrator chama `initSentry()` no topo do bootstrap e usa
 * `captureException()` nos catch-blocks dos consumers (jobs com erro fatal).
 */
let initialized = false;

export function initSentry(): boolean {
  if (initialized) return true;
  const dsn = process.env['SENTRY_DSN_WORKERS'];
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    release: process.env['HM_RELEASE'],
    tracesSampleRate: sampleRate('SENTRY_TRACES_SAMPLE_RATE'),
    sendDefaultPii: false,
  });
  initialized = true;
  return true;
}

function sampleRate(envKey: string): number {
  const raw = process.env[envKey];
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
}

export function isSentryEnabled(): boolean {
  return initialized;
}

/** Captura uma exceção de job (no-op se desabilitado). */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  if (context) {
    Sentry.captureException(error, { extra: context });
    return;
  }
  Sentry.captureException(error);
}

/** Flush pendente antes do shutdown (no-op se desabilitado). */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) return;
  await Sentry.flush(timeoutMs);
}

export { Sentry };
