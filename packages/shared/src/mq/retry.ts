/**
 * @hm/shared/mq/retry — política de entrega resiliente (DLX + retry + DLQ).
 *
 * ## Por que isto existe
 * O `consume` legado fazia `nack(msg, false, false)` em erro → mensagem
 * **descartada silenciosamente** (perda de mensagem de cliente se o DB pisca).
 * A exchange `hm.dlx` existia mas nenhuma fila roteava para ela.
 *
 * ## Estratégia escolhida — "retry ladder" por dead-letter + TTL
 * O broker de dev/prod é `rabbitmq:3.13-management-alpine` — **sem** o plugin
 * `rabbitmq_delayed_message_exchange`. O padrão portável (e o recomendado pela
 * própria RabbitMQ) é **dead-letter + x-message-ttl por nível de retry**:
 *
 *   origem ──(handler lança)──> consume republica em `hm.q.<origem>.retry.<ttl>`
 *   wait-queue (x-message-ttl=<ttl>, DLX=hm.dlx, DLRK=<origem>)
 *     ──(TTL expira)──> hm.dlx ──(rk=<origem>)──> volta à fila de origem
 *   esgotou as tentativas / erro não-retentável ──> hm.dlx (rk=hm.dlq) ──> DLQ
 *
 * ## Por que NÃO `x-dead-letter-exchange` na fila de origem
 * Os consumers (inbound/outbound/media) re-declaram a própria fila com
 * `{ durable: true }`. Adicionar um x-argument na declaração feita aqui geraria
 * `PRECONDITION_FAILED (406)` no boot deles. Então o dead-letter da ORIGEM é
 * feito pela aplicação (este módulo republica), e só as **wait-queues novas**
 * (que ninguém re-declara) carregam os x-arguments de TTL/DLX. As filas de
 * origem só ganham um *binding* extra em `hm.dlx` (binding não altera a
 * declaração → sem 406) para receberem a re-entrada pós-TTL.
 */
import type { Channel, ConsumeMessage } from 'amqplib';
import { EXCHANGES, QUEUES } from './topology';

/**
 * Backoff exponencial (ms) por tentativa. O tamanho do array = número máximo de
 * retries antes da DLQ. 5s → 30s → 2min → 10min → 30min.
 */
export const RETRY_BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000] as const;

/** Fila final inspecionável: mensagens que esgotaram retries ou são de conteúdo. */
export const DLQ_QUEUE = 'hm.q.dlq';

/** Routing key (em `hm.dlx`) que entrega na DLQ. Distinta dos nomes de fila de origem. */
export const DLQ_ROUTING_KEY = 'hm.dlq';

// Headers proprietários (prefixo x-hm-) carregados pela mensagem ao longo do ciclo.
export const RETRY_COUNT_HEADER = 'x-hm-retries';
export const ORIGIN_QUEUE_HEADER = 'x-hm-origin-queue';
export const ERROR_HEADER = 'x-hm-error';
export const DLQ_REASON_HEADER = 'x-hm-dlq-reason';
export const FAILED_AT_HEADER = 'x-hm-failed-at';

/** Motivo pelo qual uma mensagem terminou na DLQ. */
export type DlqReason = 'non_retryable' | 'max_retries_exhausted' | 'invalid_envelope';

/**
 * Erro de CONTEÚDO: reprocessar não adianta (payload inválido, provider
 * desconhecido, regra de negócio que rejeita a mensagem). Vai DIRETO para a DLQ
 * com motivo — sem gastar N tentativas. Handlers devem lançar isto (ou um
 * `ZodError`/`SyntaxError`) para sinalizar "não retente".
 */
export class NonRetryableError extends Error {
  override readonly name = 'NonRetryableError';
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

/** Contrato mínimo de logger (compatível com `@hm/logger`, sem acoplar a ele). */
export interface RetryLogger {
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/** Política de retry aplicada por `consume`. */
export interface RetryPolicy {
  /** Schedule de backoff (ms). Default: {@link RETRY_BACKOFF_MS}. */
  readonly backoffMs?: readonly number[];
  /** Decide se um erro é transitório (retentável). Default: {@link defaultIsRetryable}. */
  readonly isRetryable?: (err: unknown) => boolean;
}

/**
 * Filas cliente-facing que recebem a política resiliente **automaticamente** —
 * mesmo que o consumer chame `consume` sem opções. Os workers inbound/outbound/
 * media não podem ser editados aqui (outros slots), então a proteção é aplicada
 * por nome de fila. As demais filas mantêm o comportamento legado (nack-drop).
 */
export function reliableQueues(): readonly string[] {
  return [QUEUES.inbound, QUEUES.outbound, QUEUES.media];
}

export function isReliableQueue(queue: string): boolean {
  return reliableQueues().includes(queue);
}

/** Política default para uma fila: retry nas filas confiáveis, `null` (legado) nas demais. */
export function defaultPolicyForQueue(queue: string): RetryPolicy | null {
  return isReliableQueue(queue) ? {} : null;
}

/** Nome canônico da wait-queue de uma fila de origem para um dado nível de TTL. */
export function retryWaitQueueName(queue: string, ttlMs: number): string {
  return `${queue}.retry.${ttlMs}`;
}

function isZodError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'ZodError'
  );
}

/**
 * Classificação default: `NonRetryableError`, `SyntaxError` (JSON malformado) e
 * `ZodError` (envelope inválido) são de conteúdo (NÃO retentável). Qualquer
 * outro erro é tratado como transitório (DB indisponível, rede, etc.).
 */
export function defaultIsRetryable(err: unknown): boolean {
  if (err instanceof NonRetryableError) return false;
  if (err instanceof SyntaxError) return false;
  if (isZodError(err)) return false;
  return true;
}

function classifyDlqReason(err: unknown): DlqReason {
  if (err instanceof SyntaxError || isZodError(err)) return 'invalid_envelope';
  return 'non_retryable';
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function readRetryCount(msg: ConsumeMessage): number {
  const raw = msg.properties.headers?.[RETRY_COUNT_HEADER];
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}

function readHeaderString(msg: ConsumeMessage, key: string): string | undefined {
  const raw = msg.properties.headers?.[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

/** Contexto de uma falha de processamento a ser roteada (retry ou DLQ). */
export interface FailureContext {
  readonly channel: Channel;
  readonly queue: string;
  readonly msg: ConsumeMessage;
  readonly error: unknown;
  readonly policy: RetryPolicy;
  readonly logger?: RetryLogger | undefined;
}

/**
 * Trata uma falha de handler de forma at-least-once:
 *  - erro transitório e ainda há tentativas → republica na wait-queue do próximo
 *    nível de backoff (incrementando o contador) e dá ack na original;
 *  - erro não-retentável OU tentativas esgotadas → publica na DLQ (com motivo) e
 *    dá ack na original.
 *
 * SEMPRE dá ack na mensagem original DEPOIS de republicar — a entrega da cópia é
 * o que garante a durabilidade; o ack apenas remove a original já copiada.
 */
export function handleConsumeFailure(ctx: FailureContext): void {
  const { channel, queue, msg, error, policy, logger } = ctx;
  const backoff = policy.backoffMs ?? RETRY_BACKOFF_MS;
  const maxRetries = backoff.length;
  const attempts = readRetryCount(msg);
  const retryable = (policy.isRetryable ?? defaultIsRetryable)(error);

  if (!retryable || attempts >= maxRetries) {
    const reason: DlqReason = retryable ? 'max_retries_exhausted' : classifyDlqReason(error);
    deadLetter(ctx, attempts, reason);
    channel.ack(msg);
    logger?.error('mq message dead-lettered', {
      queue,
      attempts,
      reason,
      error: describeError(error),
    });
    return;
  }

  const ttl = backoff[Math.min(attempts, backoff.length - 1)] ?? backoff[backoff.length - 1] ?? 5_000;
  const waitQueue = retryWaitQueueName(queue, ttl);
  const nextAttempt = attempts + 1;
  channel.sendToQueue(waitQueue, msg.content, {
    persistent: true,
    contentType: msg.properties.contentType ?? 'application/json',
    headers: {
      ...msg.properties.headers,
      [RETRY_COUNT_HEADER]: nextAttempt,
      [ORIGIN_QUEUE_HEADER]: queue,
      [ERROR_HEADER]: describeError(error),
    },
  });
  channel.ack(msg);
  logger?.warn('mq message scheduled for retry', {
    queue,
    attempt: nextAttempt,
    maxRetries,
    delayMs: ttl,
  });
}

function deadLetter(ctx: FailureContext, attempts: number, reason: DlqReason): void {
  const { channel, queue, msg, error } = ctx;
  channel.publish(EXCHANGES.dlx, DLQ_ROUTING_KEY, msg.content, {
    persistent: true,
    contentType: msg.properties.contentType ?? 'application/json',
    headers: {
      ...msg.properties.headers,
      [ORIGIN_QUEUE_HEADER]: readHeaderString(msg, ORIGIN_QUEUE_HEADER) ?? queue,
      [RETRY_COUNT_HEADER]: attempts,
      [DLQ_REASON_HEADER]: reason,
      [ERROR_HEADER]: describeError(error),
      [FAILED_AT_HEADER]: new Date().toISOString(),
    },
  });
}

/**
 * Declara a infraestrutura de retry de UMA fila de origem (idempotente):
 *  - bind da fila de origem em `hm.dlx` (rk = nome da fila) para a re-entrada;
 *  - uma wait-queue por nível de backoff com `x-message-ttl` + DLX de volta à origem.
 *
 * O backoff DEVE casar com o usado em runtime (default {@link RETRY_BACKOFF_MS}),
 * pois os nomes das wait-queues embutem o TTL.
 */
export async function assertRetryTopology(
  channel: Channel,
  queue: string,
  backoffMs: readonly number[] = RETRY_BACKOFF_MS,
): Promise<void> {
  await channel.bindQueue(queue, EXCHANGES.dlx, queue);
  for (const ttl of backoffMs) {
    await channel.assertQueue(retryWaitQueueName(queue, ttl), {
      durable: true,
      arguments: {
        'x-message-ttl': ttl,
        'x-dead-letter-exchange': EXCHANGES.dlx,
        'x-dead-letter-routing-key': queue,
      },
    });
  }
}

/** Declara a DLQ final e a liga a `hm.dlx` pela routing key dedicada (idempotente). */
export async function assertDlq(channel: Channel): Promise<void> {
  await channel.assertQueue(DLQ_QUEUE, { durable: true });
  await channel.bindQueue(DLQ_QUEUE, EXCHANGES.dlx, DLQ_ROUTING_KEY);
}
