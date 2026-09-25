/**
 * Outbox transacional (F70-S16) — relay dos workers. Ver `./relay`.
 */
import { z } from 'zod';
import type { Logger } from '@hm/logger';
import { startOutboxRelay, type OutboxRelay, type OutboxRelayOptions } from './relay';

export {
  OutboxRelay,
  startOutboxRelay,
  backoffDelayMs,
  type BackoffOptions,
  type OutboxRelayOptions,
  type OutboxRelayStats,
} from './relay';

const positiveInt = z.coerce.number().int().positive();

/** Opções do relay a partir do ambiente (tudo opcional; inválido = default). */
export function outboxRelayOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): Omit<OutboxRelayOptions, 'logger'> {
  const read = (key: string): number | undefined => {
    const raw = env[key];
    if (raw === undefined || raw === '') return undefined;
    const parsed = positiveInt.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  };
  const batchSize = read('OUTBOX_BATCH_SIZE');
  const pollIntervalMs = read('OUTBOX_POLL_MS');
  const maxAttempts = read('OUTBOX_MAX_ATTEMPTS');
  const sentRetentionDays = read('OUTBOX_SENT_RETENTION_DAYS');
  const deadRetentionDays = read('OUTBOX_DEAD_RETENTION_DAYS');
  return {
    ...(batchSize !== undefined ? { batchSize } : {}),
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
    ...(maxAttempts !== undefined ? { maxAttempts } : {}),
    cleanup: {
      ...(sentRetentionDays !== undefined ? { sentRetentionDays } : {}),
      ...(deadRetentionDays !== undefined ? { deadRetentionDays } : {}),
    },
  };
}

/** Sobe o relay do processo de workers com a configuração do ambiente. */
export function startOutboxRelayFromEnv(logger: Logger): Promise<OutboxRelay> {
  return startOutboxRelay({ logger, ...outboxRelayOptionsFromEnv() });
}
