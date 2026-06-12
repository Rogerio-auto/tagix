/**
 * Instrumentação do runtime **server/edge** do @hm/web (Next 15).
 *
 * Escopo deste slot é o BROWSER; o server-side principal (api/workers/agent-runtime)
 * já foi coberto pelo F10-S01 com `@sentry/node`. Ainda assim o runtime Node/Edge
 * do próprio Next (RSC, route handlers do web) pode lançar — então registramos o
 * Sentry server-side do `@sentry/nextjs` aqui também, OPT-IN pelo MESMO
 * `NEXT_PUBLIC_SENTRY_DSN` (ou `SENTRY_DSN_WEB` se quiser separar do browser).
 *
 * No-op sem DSN: nada é importado/inicializado.
 */
import type { captureRequestError } from '@sentry/nextjs';

export async function register(): Promise<void> {
  const dsn = process.env['SENTRY_DSN_WEB'] || process.env['NEXT_PUBLIC_SENTRY_DSN'];
  if (!dsn) return;

  const runtime = process.env['NEXT_RUNTIME'];
  if (runtime !== 'nodejs' && runtime !== 'edge') return;

  const environment =
    process.env['NEXT_PUBLIC_HM_ENV'] || process.env['NODE_ENV'] || 'development';
  const release = process.env['NEXT_PUBLIC_HM_RELEASE'] || undefined;
  const rawTraces = process.env['SENTRY_TRACES_SAMPLE_RATE'];
  const parsedTraces = rawTraces ? Number.parseFloat(rawTraces) : 0;
  const tracesSampleRate =
    Number.isFinite(parsedTraces) && parsedTraces >= 0 && parsedTraces <= 1
      ? parsedTraces
      : 0;

  const Sentry = await import('@sentry/nextjs');
  Sentry.init({ dsn, environment, release, tracesSampleRate, sendDefaultPii: false });
}

/**
 * Captura erros lançados em React Server Components / nested layouts do App
 * Router. No-op seguro quando o Sentry não foi inicializado.
 */
export async function onRequestError(
  ...args: Parameters<typeof captureRequestError>
): Promise<void> {
  if (!process.env['SENTRY_DSN_WEB'] && !process.env['NEXT_PUBLIC_SENTRY_DSN']) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
}
