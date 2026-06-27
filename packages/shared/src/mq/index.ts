/**
 * @hm/shared/mq — mensageria RabbitMQ. Subpath separado (node-only) para não
 * entrar no bundle do frontend. Usado por API e workers.
 */
import { Buffer } from 'node:buffer';
import type { Channel } from 'amqplib';
import { EXCHANGES } from './topology';
import { envelopeSchema, type Envelope } from './envelope';
import {
  defaultPolicyForQueue,
  handleConsumeFailure,
  type RetryLogger,
  type RetryPolicy,
} from './retry';

export * from './envelope';
export * from './topology';
export * from './retry';
export * from './dlq';
export * from './kb';
export * from './flows';
export { connectMq } from './connection';
export type { MqHandle } from './connection';

/** Publica um envelope no exchange de eventos. */
export function publish(channel: Channel, routingKey: string, envelope: Envelope): boolean {
  return channel.publish(EXCHANGES.events, routingKey, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
}

/** Opções de consumo (retro-compatíveis: tudo opcional). */
export interface ConsumeOptions {
  /**
   * Política de retry/DLX. `undefined` (default) aplica a política padrão da fila
   * — filas cliente-facing (inbound/outbound/media) ganham retry + DLQ
   * automaticamente; as demais mantêm o nack-sem-requeue legado. Passe `null`
   * para FORÇAR o comportamento legado, ou um objeto para customizar.
   */
  readonly retry?: RetryPolicy | null;
  /** Logger estruturado opcional para os eventos de retry/DLQ. */
  readonly logger?: RetryLogger;
}

/**
 * Consome uma fila validando o envelope (Zod).
 *
 * - Sucesso → `ack`.
 * - Erro numa fila SEM política (default p/ filas não-confiáveis) → `nack` sem
 *   requeue (comportamento legado preservado; não regride consumers atuais).
 * - Erro numa fila COM política (default p/ inbound/outbound/media) → retry com
 *   backoff exponencial; esgotado o limite ou erro de conteúdo → DLQ. A mensagem
 *   nunca é descartada silenciosamente.
 *
 * Handlers que tratam erro de conteúdo retornando normalmente (sem lançar)
 * continuam sendo `ack`ados — só uma exceção LANÇADA dispara retry/DLQ.
 */
export async function consume(
  channel: Channel,
  queue: string,
  handler: (envelope: Envelope) => Promise<void>,
  opts?: ConsumeOptions,
): Promise<void> {
  const policy = opts?.retry === undefined ? defaultPolicyForQueue(queue) : opts.retry;
  await channel.consume(queue, (msg) => {
    if (!msg) return;
    void (async () => {
      try {
        const envelope = envelopeSchema.parse(JSON.parse(msg.content.toString()));
        await handler(envelope);
        channel.ack(msg);
      } catch (err) {
        if (!policy) {
          channel.nack(msg, false, false);
          return;
        }
        handleConsumeFailure({ channel, queue, msg, error: err, policy, logger: opts?.logger });
      }
    })();
  });
}
