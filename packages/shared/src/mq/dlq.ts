/**
 * @hm/shared/mq/dlq — inspeção e operação da DLQ (`hm.q.dlq`).
 *
 * A DLQ é a fila final onde param as mensagens que esgotaram retries ou são de
 * conteúdo inválido. Estas helpers permitem que a operação inspecione, reprocesse
 * (replay para a fila de origem) ou esvazie a DLQ sem perder mensagens por
 * acidente. A UI visual disso é F52-S09; aqui é a base programática/CLI.
 */
import type { Channel, GetMessage, Message } from 'amqplib';
import {
  DLQ_QUEUE,
  DLQ_REASON_HEADER,
  ERROR_HEADER,
  FAILED_AT_HEADER,
  ORIGIN_QUEUE_HEADER,
  RETRY_COUNT_HEADER,
} from './retry';

/** Registro legível de uma mensagem parada na DLQ. */
export interface DlqRecord {
  readonly originQueue: string | null;
  readonly retries: number | null;
  readonly reason: string | null;
  readonly error: string | null;
  readonly failedAt: string | null;
  /** Conteúdo bruto (string) — o operador decide como interpretar. */
  readonly body: string;
}

function headerString(msg: Message, key: string): string | null {
  const raw = msg.properties.headers?.[key];
  return typeof raw === 'string' ? raw : null;
}

function headerNumber(msg: Message, key: string): number | null {
  const raw = msg.properties.headers?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function toRecord(msg: Message): DlqRecord {
  return {
    originQueue: headerString(msg, ORIGIN_QUEUE_HEADER),
    retries: headerNumber(msg, RETRY_COUNT_HEADER),
    reason: headerString(msg, DLQ_REASON_HEADER),
    error: headerString(msg, ERROR_HEADER),
    failedAt: headerString(msg, FAILED_AT_HEADER),
    body: msg.content.toString(),
  };
}

/**
 * Inspeção NÃO-destrutiva: lê até `max` mensagens e as devolve à DLQ (nack com
 * requeue). Útil para diagnóstico. Não garante ordem estável entre chamadas.
 */
export async function inspectDlq(
  channel: Channel,
  opts: { readonly max?: number } = {},
): Promise<DlqRecord[]> {
  const max = opts.max ?? 50;
  const taken: GetMessage[] = [];
  const records: DlqRecord[] = [];
  for (let i = 0; i < max; i += 1) {
    const msg = await channel.get(DLQ_QUEUE, { noAck: false });
    if (msg === false) break;
    taken.push(msg);
    records.push(toRecord(msg));
  }
  for (const msg of taken) channel.nack(msg, false, true);
  return records;
}

/**
 * Reprocessa (replay) mensagens da DLQ de volta para a fila de origem indicada
 * no header `x-hm-origin-queue`. Por padrão zera o contador de retries para dar
 * à mensagem um ciclo completo novo. Mensagens sem origem conhecida são devolvidas
 * à DLQ (nunca descartadas). Retorna quantas foram reenviadas.
 */
export async function replayDlq(
  channel: Channel,
  opts: { readonly max?: number; readonly resetRetries?: boolean } = {},
): Promise<number> {
  const max = opts.max ?? 50;
  const resetRetries = opts.resetRetries ?? true;
  const requeued: GetMessage[] = [];
  let moved = 0;
  for (let i = 0; i < max; i += 1) {
    const msg = await channel.get(DLQ_QUEUE, { noAck: false });
    if (msg === false) break;
    const origin = headerString(msg, ORIGIN_QUEUE_HEADER);
    if (!origin) {
      requeued.push(msg);
      continue;
    }
    const headers = { ...msg.properties.headers };
    if (resetRetries) delete headers[RETRY_COUNT_HEADER];
    channel.sendToQueue(origin, msg.content, {
      persistent: true,
      contentType: msg.properties.contentType ?? 'application/json',
      headers,
    });
    channel.ack(msg);
    moved += 1;
  }
  for (const msg of requeued) channel.nack(msg, false, true);
  return moved;
}

/** Esvazia a DLQ por completo. Destrutivo — retorna o nº de mensagens removidas. */
export async function purgeDlq(channel: Channel): Promise<number> {
  const res = await channel.purgeQueue(DLQ_QUEUE);
  return res.messageCount;
}
