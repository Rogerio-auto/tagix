/**
 * Instrumentação do **browser** (Next 15 App Router). Roda no client antes do
 * resto da app hidratar. É o substituto oficial do antigo `sentry.client.config`.
 *
 * OPT-IN: sem `NEXT_PUBLIC_SENTRY_DSN`, `getSentryBrowserConfig()` retorna null e
 * NÃO chamamos `Sentry.init` — zero conexão, zero overhead em dev/local. Mesmo
 * padrão do server-side (apps/api/src/observability/sentry.ts).
 */
import * as Sentry from '@sentry/nextjs';
import { getSentryBrowserConfig } from './shared/lib/sentry/config';

const config = getSentryBrowserConfig();

if (config) {
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: config.tracesSampleRate,
    replaysSessionSampleRate: config.replaysSessionSampleRate,
    replaysOnErrorSampleRate: config.replaysOnErrorSampleRate,
    // Não enviar PII por padrão (telefones/e-mails de contatos não vazam).
    sendDefaultPii: false,
    // Replay só é anexado quando alguma sample rate de replay > 0.
    integrations:
      config.replaysSessionSampleRate > 0 || config.replaysOnErrorSampleRate > 0
        ? [Sentry.replayIntegration()]
        : [],
  });
}
