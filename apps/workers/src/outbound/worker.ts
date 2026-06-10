/**
 * Worker outbound — composição (LIVECHAT.md §3.1).
 *
 * ```
 * consume hm.q.outbound → parseOutboundJob (Zod)
 *   → runWithDistributedLock(`hm:lock:outbound:${conversationId}`, 90s)
 *       → resolve canal+adapter → dispatchOutbound (valida kind↔provider)
 *       → finalizeOutbound (persist + socket emit)
 *   → ack/nack
 * ```
 *
 * `consume` de `@hm/shared/mq` já valida o `Envelope`, faz `ack` em sucesso e
 * `nack(requeue=false)` se o handler lançar. Erros de *negócio* (mismatch,
 * falha do provider) NÃO lançam: viram `view_status: failed` persistido e o job
 * é ack'd (não há ganho em reprocessar um payload imutável). Só erros de
 * *infra* (lock/DB/MQ) propagam para nack → DLX.
 */
import { connectMq, consume, type Envelope } from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import { runWithDistributedLock, type LockStore } from '../lock';
import { parseOutboundJob, type OutboundJob } from './job';
import { dispatchOutbound } from './dispatch';
import { finalizeOutbound } from './finalize';
import { runPresencePreAction } from './presence';
import type { OutboundDeps } from './ports';

/** Fila canônica de outbound (topology: `QUEUES.outbound`). */
export const OUTBOUND_QUEUE = 'hm.q.outbound' as const;

/** TTL do lock por conversa (LIVECHAT.md §3.4). */
export const OUTBOUND_LOCK_TTL_MS = 90_000;

/** Chave de lock FIFO por conversa. */
export function lockKey(conversationId: string): string {
  return `hm:lock:outbound:${conversationId}`;
}

export interface OutboundWorkerOptions {
  readonly deps: OutboundDeps;
  readonly logger: Logger;
  /** Backend de lock (default: FIFO em memória — ver `lock.ts`). */
  readonly lockStore?: LockStore;
}

/**
 * Processa um único envelope (testável sem RabbitMQ). Lança apenas em falha de
 * infra (lock/persistência) — o caller (`consume`) converte em nack.
 */
export async function handleOutboundEnvelope(
  envelope: Envelope,
  options: OutboundWorkerOptions,
): Promise<void> {
  const { deps, logger, lockStore } = options;
  const job: OutboundJob = parseOutboundJob(envelope.payload);
  const workspaceId = envelope.workspaceId;

  await runWithDistributedLock(
    lockKey(job.conversationId),
    OUTBOUND_LOCK_TTL_MS,
    async () => {
      const { channel, adapter } = await deps.channels.resolve(job.channelId, workspaceId);

      // Pre-action: dispara "digitando…" no canal antes do envio real (F1-S21).
      // Best-effort — falha aqui não bloqueia o envio.
      await runPresencePreAction(job, channel, adapter, logger);

      const dispatch = await dispatchOutbound(job, channel, adapter);

      if (!dispatch.result.ok) {
        logger.warn('outbound: envio não concluído', {
          kind: job.kind,
          conversationId: job.conversationId,
          messageId: job.messageId,
          provider: channel.provider,
          dispatched: dispatch.dispatched,
          errorCode: dispatch.result.errorCode,
        });
      }

      await finalizeOutbound(job, dispatch.result, workspaceId, deps);
    },
    lockStore,
  );
}

export interface OutboundWorkerHandle {
  stop(): Promise<void>;
}

/**
 * Inicia o consumer de `hm.q.outbound`. Conecta ao RabbitMQ, garante a fila e
 * registra o handler. Retorna um handle para parada limpa.
 */
export async function startOutboundWorker(
  options: OutboundWorkerOptions,
): Promise<OutboundWorkerHandle> {
  const { logger } = options;
  const { connection, channel } = await connectMq();
  await channel.assertQueue(OUTBOUND_QUEUE, { durable: true });
  // Um job por vez por conexão → o lock FIFO em memória ordena por conversa.
  await channel.prefetch(1);

  await consume(channel, OUTBOUND_QUEUE, async (envelope) => {
    await handleOutboundEnvelope(envelope, options);
  });

  logger.info('outbound worker iniciado', { queue: OUTBOUND_QUEUE });

  return {
    async stop(): Promise<void> {
      await channel.close();
      await connection.close();
      logger.info('outbound worker parado', { queue: OUTBOUND_QUEUE });
    },
  };
}
