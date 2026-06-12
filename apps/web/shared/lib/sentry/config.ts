/**
 * Configuração compartilhada do Sentry browser (opt-in). Estes helpers são
 * isomórficos e NÃO importam `@sentry/nextjs` — apenas leem env e derivam os
 * valores de init. Mantê-los livres da dep garante que o módulo possa ser
 * importado em qualquer runtime sem custo.
 *
 * Padrão da casa (igual ao server-side em apps/api/src/observability/sentry.ts):
 * NADA liga sem env. Sem `NEXT_PUBLIC_SENTRY_DSN` tudo vira no-op.
 */

/**
 * DSN do browser. `NEXT_PUBLIC_` porque é embutido no bundle client.
 * Acesso por colchete com chave literal: satisfaz `noPropertyAccessFromIndexSignature`
 * e o Next ainda inlina o valor em build (vide outros `process.env['NEXT_PUBLIC_*']`
 * do app). Sem DSN → `undefined` → todo o init vira no-op.
 */
export const SENTRY_DSN: string | undefined =
  process.env['NEXT_PUBLIC_SENTRY_DSN'] || undefined;

/** True quando o Sentry browser deve ligar (DSN presente). */
export function isSentryEnabled(): boolean {
  return Boolean(SENTRY_DSN);
}

/**
 * Lê uma sample rate `[0,1]` de env. Valor ausente/inválido → fallback.
 * Default 0 (sem custo) para tracing; replay também opt-in.
 */
function readSampleRate(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

/** Opções derivadas de env para `Sentry.init` no browser. */
export interface SentryBrowserConfig {
  dsn: string;
  environment: string;
  release: string | undefined;
  tracesSampleRate: number;
  replaysSessionSampleRate: number;
  replaysOnErrorSampleRate: number;
}

/**
 * Monta a config do browser a partir de env. Retorna `null` quando o DSN está
 * ausente — o caller deve então pular o `Sentry.init` por completo (no-op).
 */
export function getSentryBrowserConfig(): SentryBrowserConfig | null {
  const dsn = SENTRY_DSN;
  if (!dsn) return null;
  return {
    dsn,
    environment:
      process.env['NEXT_PUBLIC_HM_ENV'] || process.env['NODE_ENV'] || 'development',
    release: process.env['NEXT_PUBLIC_HM_RELEASE'] || undefined,
    tracesSampleRate: readSampleRate(
      process.env['NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE'],
      0,
    ),
    replaysSessionSampleRate: readSampleRate(
      process.env['NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE'],
      0,
    ),
    replaysOnErrorSampleRate: readSampleRate(
      process.env['NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE'],
      0,
    ),
  };
}
