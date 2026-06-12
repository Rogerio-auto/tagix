'use client';

import * as Sentry from '@sentry/nextjs';
import { isSentryEnabled } from './config';

/**
 * Captura manual de exceção no browser (no-op quando o Sentry está desligado —
 * sem DSN). Útil em catch-blocks que tratam o erro mas ainda querem reportá-lo,
 * e no `global-error.tsx`. Espelha `captureException` do server-side.
 */
export function captureException(error: unknown): void {
  if (!isSentryEnabled()) return;
  Sentry.captureException(error);
}
