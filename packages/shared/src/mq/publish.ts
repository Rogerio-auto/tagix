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
 * O canal fechou enquanto a publicação esperava o buffer drenar (F58-S12). A
 * mensagem pode NÃO ter chegado ao broker: quem publica precisa tratar como falha
 * (a outbox mantém a linha e tenta de novo), nunca como sucesso.
 */
export class MqChannelClosedError extends Error {
  constructor() {
    super('Canal AMQP fechou antes de drenar: a publicação pode não ter chegado ao broker.');
    this.name = 'MqChannelClosedError';
  }
}

/**
 * Se a escrita sinalizou buffer cheio (`ok === false`), contabiliza e espera o
 * canal drenar antes de resolver. No-op quando há espaço. `Channel` é um
 * EventEmitter, então `once(channel, 'drain')` resolve na próxima drenagem.
 *
 * F58-S12: corre contra `close` — um canal que cai com o buffer cheio nunca emite
 * `drain`, e a espera antiga ficava pendurada para sempre (o produtor travava sem
 * erro). Agora rejeita com `MqChannelClosedError`; `error` no canal rejeita com o
 * próprio erro. Os ouvintes são removidos em qualquer desfecho.
 */
export async function awaitDrainIfNeeded(channel: Channel, ok: boolean): Promise<void> {
  if (ok) return;
  incMqStat('publishBackpressure');
  const abort = new AbortController();
  const drained = once(channel, 'drain', { signal: abort.signal }).then(() => 'drain' as const);
  const closed = once(channel, 'close', { signal: abort.signal }).then(() => 'close' as const);
  // O perdedor é abortado no `finally`: a rejeição dele (AbortError) é esperada.
  drained.catch(() => undefined);
  closed.catch(() => undefined);
  try {
    const winner = await Promise.race([drained, closed]);
    if (winner === 'close') throw new MqChannelClosedError();
  } finally {
    abort.abort();
  }
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
