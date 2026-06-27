/**
 * apps/workers/src/dlq — operação da Dead-Letter Queue (`hm.q.dlq`).
 *
 * A malha de entrega resiliente (DLX + retry + DLQ) vive em `@hm/shared/mq`
 * (`retry.ts` / `dlq.ts`). Este módulo é a camada operacional para os WORKERS:
 * inspecionar, reprocessar (replay) e esvaziar a DLQ. A UI visual é F52-S09.
 *
 * Uso via CLI (a partir da raiz do monorepo):
 *   pnpm --filter @hm/workers exec tsx --env-file=../../.env src/dlq/cli.ts inspect
 *   pnpm --filter @hm/workers exec tsx --env-file=../../.env src/dlq/cli.ts replay --max 100
 *   pnpm --filter @hm/workers exec tsx --env-file=../../.env src/dlq/cli.ts purge
 */
import {
  assertDlq,
  connectMq,
  inspectDlq,
  purgeDlq,
  replayDlq,
  type DlqRecord,
  type MqHandle,
} from '@hm/shared/mq';

export { inspectDlq, replayDlq, purgeDlq, type DlqRecord } from '@hm/shared/mq';

/** Conecta, garante a DLQ declarada e executa `fn`, fechando tudo ao final. */
export async function withDlqChannel<T>(fn: (handle: MqHandle) => Promise<T>): Promise<T> {
  const handle = await connectMq();
  try {
    await assertDlq(handle.channel);
    return await fn(handle);
  } finally {
    await handle.channel.close().catch(() => undefined);
    await handle.connection.close().catch(() => undefined);
  }
}

/** Lê (sem remover) até `max` mensagens da DLQ. */
export async function inspect(max = 50): Promise<DlqRecord[]> {
  return withDlqChannel(({ channel }) => inspectDlq(channel, { max }));
}

/** Reenvia até `max` mensagens da DLQ para suas filas de origem. Retorna o total movido. */
export async function replay(max = 50, resetRetries = true): Promise<number> {
  return withDlqChannel(({ channel }) => replayDlq(channel, { max, resetRetries }));
}

/** Esvazia a DLQ. Retorna o nº de mensagens removidas. */
export async function purge(): Promise<number> {
  return withDlqChannel(({ channel }) => purgeDlq(channel));
}
