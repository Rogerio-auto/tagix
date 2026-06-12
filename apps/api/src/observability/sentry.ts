import * as Sentry from '@sentry/node';

/**
 * Sentry **opt-in** para a API. No-op completo sem `SENTRY_DSN_API`: nenhuma
 * conexão, nenhuma exceção, nenhum overhead. Mesmo padrão de `@hm/logger` OTel
 * (nada liga sem env). Idempotente — chamadas repetidas são ignoradas.
 *
 * O orchestrator chama `initSentry()` no topo do bootstrap (antes de criar o
 * app), e monta `sentryErrorHandler()` como ÚLTIMO middleware antes do error
 * handler central (em F10, o wire em app.ts é do orchestrator).
 */
let initialized = false;

export function initSentry(): boolean {
  if (initialized) return true;
  const dsn = process.env['SENTRY_DSN_API'];
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    release: process.env['HM_RELEASE'],
    // Tracing opt-in: 0 por default (sem custo); ajustável por env.
    tracesSampleRate: sampleRate('SENTRY_TRACES_SAMPLE_RATE'),
    // Não enviar PII por padrão (telefones/e-mails de contatos não vazam).
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

/** True quando o Sentry foi efetivamente inicializado (DSN presente). */
export function isSentryEnabled(): boolean {
  return initialized;
}

/**
 * Captura uma exceção manualmente (no-op se desabilitado). Útil em catch-blocks
 * que tratam o erro mas ainda querem reportá-lo.
 */
export function captureException(error: unknown): void {
  if (!initialized) return;
  Sentry.captureException(error);
}

/**
 * Error handler Express do Sentry (4-args). No-op seguro quando desabilitado —
 * apenas repassa ao próximo handler. Deve preceder o `errorHandler` central.
 */
export function sentryErrorHandler(): ReturnType<typeof Sentry.expressErrorHandler> {
  return Sentry.expressErrorHandler();
}

export { Sentry };
