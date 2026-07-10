/**
 * @hm/shared/mq/publish — publish/sendToQueue cientes de backpressure (F56-S12, INF-12).
 *
 * `Channel.publish`/`sendToQueue` retornam `false` quando o write buffer do
 * socket está cheio: continuar publicando acumula a mensagem só na memória do
 * processo, que se perde se a conexão cair antes do flush. Os helpers abaixo
 * aguardam o evento `drain` do canal antes de resolver, e contabilizam o evento
 * em `mqStats().publishBackpressure`. São aditivos — a `publish()` síncrona
 * legada (index.ts) permanece para quem não precisa de garantia sob pressão.
 */
import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import type { Channel } from 'amqplib';
import { EXCHANGES } from './topology';
import { type Envelope } from './envelope';
import { incMqStat } from './stats';

/**
 * Se a escrita sinalizou buffer cheio (`ok === false`), contabiliza e espera o
 * canal drenar antes de resolver. No-op quando há espaço. `Channel` é um
 * EventEmitter, então `once(channel, 'drain')` resolve na próxima drenagem.
 */
export async function awaitDrainIfNeeded(channel: Channel, ok: boolean): Promise<void> {
  if (ok) return;
  incMqStat('publishBackpressure');
  await once(channel, 'drain');
}

/** `channel.publish` no exchange de eventos, respeitando backpressure. */
export async function publishWithBackpressure(
  channel: Channel,
  routingKey: string,
  envelope: Envelope,
): Promise<void> {
  const ok = channel.publish(
    EXCHANGES.events,
    routingKey,
    Buffer.from(JSON.stringify(envelope)),
    { persistent: true, contentType: 'application/json' },
  );
  await awaitDrainIfNeeded(channel, ok);
}

/** `channel.sendToQueue` direto numa fila, respeitando backpressure. */
export async function sendToQueueWithBackpressure(
  channel: Channel,
  queue: string,
  envelope: Envelope,
): Promise<void> {
  const ok = channel.sendToQueue(queue, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
  await awaitDrainIfNeeded(channel, ok);
}
