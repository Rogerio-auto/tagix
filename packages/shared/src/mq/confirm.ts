/**
 * @hm/shared/mq/confirm — publicação com publisher confirms (F70-S16).
 *
 * O `publish`/`sendToQueue` comum só diz que a mensagem entrou no buffer do socket:
 * se a conexão cair antes do flush, ela some sem erro. Aqui o canal é de CONFIRMAÇÃO
 * e cada mensagem só conta como publicada quando o broker devolve `basic.ack` — ou
 * seja, quando ela já está nas filas duráveis de destino. O relay da outbox só marca
 * `sent` depois disso.
 *
 * - `mandatory: true`: mensagem sem rota (fila inexistente, bind faltando) volta como
 *   `basic.return` ANTES do ack; sem isso o broker a descartaria e ainda confirmaria.
 *   Mensagem devolvida conta como falha (`unroutable`) e é retentada.
 * - `nack` do broker → falha.
 * - Sem confirmação dentro do prazo → falha (`confirm_timeout`) e o canal é fechado:
 *   um ack atrasado depois disso não pode mais confundir o lote seguinte. O relay abre
 *   outro. Pode duplicar (o broker talvez tenha aceitado): pelo menos uma vez, com dedup
 *   no consumidor.
 *
 * Conexão própria, sem a reconexão automática do `connectMq`: quem usa (o relay)
 * observa {@link ConfirmPublisher.isOpen} e reabre com backoff, sem reivindicar linhas
 * enquanto o broker está fora.
 */
import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { connect, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import type { Envelope } from './envelope';
import type { RetryLogger } from './retry';
import { assertTopology } from './topology';

/** Header com a chave local da mensagem (casa `basic.return` com o item do lote). */
export const CONFIRM_KEY_HEADER = 'x-hm-outbox-id';

export interface ConfirmPublishItem {
  /** Chave local do item no lote (o relay usa o id da linha da outbox). */
  readonly key: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly envelope: Envelope;
}

/** `null` = confirmado pelo broker; string = motivo da falha. */
export type ConfirmResult = string | null;

export interface ConfirmPublisher {
  /** Publica o lote e espera cada confirmação. Nunca lança: falha vira resultado. */
  publishBatch(items: readonly ConfirmPublishItem[]): Promise<Map<string, ConfirmResult>>;
  /** Conexão e canal abertos. */
  isOpen(): boolean;
  close(): Promise<void>;
}

export interface OpenConfirmPublisherOptions {
  readonly url?: string;
  /** Prazo para as confirmações de um lote (default 10s). */
  readonly confirmTimeoutMs?: number;
  /** Declara a topologia no canal ao abrir (default true). */
  readonly assertTopology?: boolean;
  readonly logger?: RetryLogger;
}

export const DEFAULT_CONFIRM_TIMEOUT_MS = 10_000;

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function headerKey(msg: ConsumeMessage): string | null {
  const headers: Record<string, unknown> | undefined = msg.properties.headers;
  const value = headers?.[CONFIRM_KEY_HEADER];
  return typeof value === 'string' ? value : null;
}

/** Abre conexão + canal de confirmação. Falha rápido (broker fora → lança). */
export async function openConfirmPublisher(
  opts: OpenConfirmPublisherOptions = {},
): Promise<ConfirmPublisher> {
  const url = opts.url ?? process.env['AMQP_URL'];
  if (!url) throw new Error('Variável de ambiente obrigatória ausente: AMQP_URL');
  const timeoutMs = opts.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;

  const conn = await connect(url);
  let channel: ConfirmChannel;
  try {
    channel = await conn.createConfirmChannel();
  } catch (err) {
    await Promise.resolve(conn.close()).catch(() => undefined);
    throw err;
  }

  let open = true;
  let closing = false;
  // Mensagens devolvidas por falta de rota, por chave (preenchido antes do ack).
  const returned = new Set<string>();

  conn.on('error', (err: unknown) => {
    opts.logger?.warn('outbox publisher: erro na conexão AMQP', { error: describe(err) });
  });
  conn.on('close', () => {
    open = false;
  });
  channel.on('error', (err: unknown) => {
    opts.logger?.warn('outbox publisher: erro no canal AMQP', { error: describe(err) });
  });
  channel.on('close', () => {
    open = false;
  });
  channel.on('return', (msg: ConsumeMessage) => {
    const key = headerKey(msg);
    if (key !== null) returned.add(key);
  });

  if (opts.assertTopology !== false) {
    try {
      await assertTopology(channel);
    } catch (err) {
      open = false;
      await Promise.resolve(conn.close()).catch(() => undefined);
      throw err;
    }
  }

  async function close(): Promise<void> {
    if (closing) return;
    closing = true;
    open = false;
    try {
      await channel.close();
    } catch {
      /* já fechado */
    }
    try {
      await conn.close();
    } catch {
      /* já fechado */
    }
  }

  async function publishBatch(
    items: readonly ConfirmPublishItem[],
  ): Promise<Map<string, ConfirmResult>> {
    const results = new Map<string, ConfirmResult>();
    if (items.length === 0) return results;
    if (!open) {
      for (const item of items) results.set(item.key, 'broker_unavailable');
      return results;
    }
    for (const item of items) returned.delete(item.key);

    const pending: Promise<void>[] = [];
    for (const item of items) {
      let settle: () => void = () => undefined;
      pending.push(
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
      );
      let ok = true;
      try {
        ok = channel.publish(
          item.exchange,
          item.routingKey,
          Buffer.from(JSON.stringify(item.envelope)),
          {
            persistent: true,
            mandatory: true,
            contentType: 'application/json',
            messageId: item.envelope.id,
            headers: { [CONFIRM_KEY_HEADER]: item.key },
          },
          (err: unknown) => {
            if (!results.has(item.key)) {
              results.set(item.key, err ? `nack: ${describe(err)}` : null);
            }
            settle();
          },
        );
      } catch (err: unknown) {
        results.set(item.key, `publish_failed: ${describe(err)}`);
        settle();
      }
      // Buffer do socket cheio: espera drenar antes do próximo (ou o canal cair).
      if (!ok && open) {
        await Promise.race([once(channel, 'drain'), once(channel, 'close')]);
      }
    }

    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      Promise.all(pending).then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), timeoutMs);
        timer.unref?.();
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);

    if (timedOut) {
      for (const item of items) {
        if (!results.has(item.key)) results.set(item.key, 'confirm_timeout');
      }
      opts.logger?.warn('outbox publisher: confirmação não chegou no prazo — canal descartado', {
        timeoutMs,
        items: items.length,
      });
      await close();
    }

    // `basic.return` chega antes do ack da mesma mensagem: já está no conjunto.
    for (const item of items) {
      if (returned.delete(item.key) && results.get(item.key) === null) {
        results.set(item.key, `unroutable: ${item.exchange || '(default)'} ${item.routingKey}`);
      }
    }
    return results;
  }

  return {
    publishBatch,
    isOpen: () => open,
    close,
  };
}
