/**
 * CLI operacional da DLQ. Roda com tsx; lê AMQP_URL do ambiente (via --env-file).
 *
 *   tsx --env-file=../../.env src/dlq/cli.ts inspect [--max N]
 *   tsx --env-file=../../.env src/dlq/cli.ts replay  [--max N] [--keep-retries]
 *   tsx --env-file=../../.env src/dlq/cli.ts purge
 */
import { createLogger } from '@hm/logger';
import { inspect, purge, replay } from './index';

const log = createLogger('info', { component: 'dlq-cli' });

function readMax(argv: readonly string[], fallback: number): number {
  const i = argv.indexOf('--max');
  if (i === -1) return fallback;
  const raw = argv[i + 1];
  const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'inspect': {
      const records = await inspect(readMax(rest, 50));
      log.info('dlq inspect', { count: records.length });
      for (const r of records) {
        log.info('dlq message', {
          originQueue: r.originQueue,
          retries: r.retries,
          reason: r.reason,
          error: r.error,
          failedAt: r.failedAt,
        });
      }
      return;
    }
    case 'replay': {
      const moved = await replay(readMax(rest, 50), !rest.includes('--keep-retries'));
      log.info('dlq replay', { moved });
      return;
    }
    case 'purge': {
      const removed = await purge();
      log.info('dlq purge', { removed });
      return;
    }
    default:
      log.error('uso: dlq <inspect|replay|purge> [--max N] [--keep-retries]', { command });
      process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  log.error('dlq cli falhou', { error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
