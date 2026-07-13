/**
 * Retry durável de envio outbound (F56-S14 / AUDITORIA_TECNICA §3.2 — INF-02).
 *
 * ## O problema
 * Uma falha TRANSITÓRIA da borda (429, 5xx, timeout) queimava a mensagem: o
 * adapter engolia o erro, `finalize` persistia `failed` e o job era ack'd. O
 * cliente nunca recebia a mensagem e ninguém era avisado. Perder mensagem de
 * cliente é a falha mais cara do produto.
 *
 * ## A taxonomia (única fonte da verdade)
 *
 * | Classe        | Exemplos                                             | Ação |
 * |---------------|------------------------------------------------------|------|
 * | **transitória** | timeout/rede (httpStatus 0), 429, 5xx, rate limit da app/WABA (4, 368, 80007, 130429), erro genérico/temporário (1, 2, 131000, 131016), WAHA 408/425/429/5xx | reprocessa pela ladder durável (5s→30s→2m→10m→30m) |
 * | **permanente**  | número sem WhatsApp (131026), fora da janela 24h (131047), template inválido (132xxx), parâmetro inválido (100/131009), token/config, janela IG fechada, mismatch kind↔provider | `failed` persistido, visível ao usuário, sem retry |
 *
 * Default seguro: **desconhecido = permanente**. Retentar 6× um erro que nunca
 * vai passar só atrasa o feedback ao operador e gasta quota da Meta.
 *
 * ## Durabilidade
 * O reprocessamento é do broker (`@hm/shared/mq` — retry ladder por dead-letter
 * + TTL, filas duráveis), não um `setTimeout` em memória: um restart do worker
 * no meio do backoff NÃO perde a mensagem. O contador de tentativas vive no
 * Postgres (`messages.metadata.sendAttempts`) pelo mesmo motivo — e porque o
 * `Envelope` não carrega o header de retry do AMQP até o handler.
 *
 * ## Terminal honesto
 * Esgotadas as {@link MAX_SEND_ATTEMPTS} tentativas, a mensagem vira `failed`
 * (com o `errorCode` do provider) em vez de sumir na DLQ em estado `pending`
 * eterno: o operador VÊ a falha e pode reenviar. O evento é logado em `error`
 * com o contador — a DLQ fica reservada para erro de infra (DB/lock/MQ).
 *
 * ## Trade-off aceito (FIFO)
 * Um job em retry sai da fila e volta depois do TTL: mensagens seguintes da
 * MESMA conversa podem passar na frente. A alternativa — segurar a conversa
 * inteira até a Meta voltar — é head-of-line blocking: um 429 num contato
 * congelaria o atendimento. Entregar fora de ordem é ruim; não entregar é pior.
 */
import type { SendResult } from '@hm/channels';
import { MetaError, isRetryableStatus } from '@hm/channels';
import type { ChannelProvider } from '@hm/shared';
import { RETRY_BACKOFF_MS } from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import { finalizeOutbound } from './finalize';
import type { OutboundJob } from './job';
import type { OutboundDeps } from './ports';

/**
 * Tentativas de envio ao provider antes de desistir e marcar `failed`.
 *
 * Derivado da ladder de `@hm/shared/mq`: `RETRY_BACKOFF_MS.length` re-entregas
 * + a entrega original = 6 chamadas ao provider ao longo de ~43 min. O `+1` é
 * proposital: na ÚLTIMA tentativa o worker NÃO lança (marca `failed` e ack'a),
 * então o job nunca chega à DLQ por falha de provider.
 */
export const MAX_SEND_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

/** Falha de envio já normalizada (o que vai para `failed_reason` se esgotar). */
export interface SendFailure {
  readonly errorCode: string;
  readonly errorMessage: string;
}

/**
 * Sinaliza ao `consume` (`@hm/shared/mq`) que o job deve voltar pela ladder
 * durável. É um `Error` comum de propósito: `defaultIsRetryable` o classifica
 * como transitório (só `NonRetryableError`/`ZodError`/`SyntaxError` viram DLQ
 * direta).
 */
export class TransientSendError extends Error {
  override readonly name = 'TransientSendError';

  constructor(
    readonly failure: SendFailure,
    readonly attempt: number,
    readonly maxAttempts: number,
  ) {
    super(
      `outbound: falha transitória do provider (${failure.errorCode}) — tentativa ${attempt}/${maxAttempts}: ${failure.errorMessage}`,
    );
    Object.setPrototypeOf(this, TransientSendError.prototype);
  }
}

/** Prefixo do `errorCode` por provider (mesma convenção dos adapters). */
function codePrefix(provider: ChannelProvider): string {
  switch (provider) {
    case 'meta_whatsapp':
      return 'WA';
    case 'meta_instagram':
      return 'IG';
    default:
      return 'WAHA';
  }
}

/** `errorCode` estável a partir de um `MetaError` (espelha o dos adapters). */
function metaErrorCode(err: MetaError, provider: ChannelProvider): string {
  const prefix = codePrefix(provider);
  if (err.code !== undefined) return `${prefix}_${err.code}`;
  if (err.httpStatus === 0) return `${prefix}_NETWORK`;
  return `${prefix}_HTTP_${err.httpStatus}`;
}

/**
 * Classifica uma exceção lançada pelo adapter. Devolve a falha normalizada se
 * for transitória do PROVIDER; `null` se não for (erro de infra/bug → sobe para
 * o `consume`, que já tem a própria ladder + DLQ — F56-S12).
 *
 * O adapter WhatsApp lança `MetaError { retryable: true }` exatamente nesse caso
 * (ver `packages/channels/src/meta/whatsapp/adapter.ts`).
 */
export function transientFailureFromError(
  err: unknown,
  provider: ChannelProvider,
): SendFailure | null {
  if (!(err instanceof MetaError)) return null;
  if (!err.retryable && !isRetryableStatus(err.httpStatus)) return null;
  return { errorCode: metaErrorCode(err, provider), errorMessage: err.message };
}

/**
 * Códigos de `SendResult.ok=false` que, apesar de virem como *resultado*, são
 * transitórios. Cobre os adapters que ainda não lançam (Instagram/WAHA) — e
 * serve de defesa em profundidade para o WhatsApp. Allowlist explícita: o que
 * não está aqui é permanente.
 */
const TRANSIENT_RESULT_CODES: ReadonlySet<string> = new Set([
  // WhatsApp Cloud API (o adapter WA já lança nesses casos; redundância barata).
  'WA_4', // limite de chamadas da app
  'WA_368', // ação bloqueada temporariamente
  'WA_80007', // rate limit da conta
  'WA_130429', // rate limit da WABA
  'WA_131000', // erro genérico/temporário
  'WA_131016', // serviço WhatsApp indisponível
  'WA_NETWORK', // timeout/rede
  // Instagram (Graph): rate limit / temporário.
  'IG_1',
  'IG_2',
  'IG_4',
  'IG_17',
  'IG_613',
  'IG_80007',
]);

/** `WAHA_<httpStatus>`: rede (0), 408, 425, 429 e 5xx são transitórios. */
function isTransientWahaCode(code: string): boolean {
  const match = /^WAHA_(\d{1,3})$/.exec(code);
  const raw = match?.[1];
  if (raw === undefined) return false;
  const status = Number(raw);
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Falha transitória expressa como `SendResult` falho? (`null` = permanente). */
export function transientFailureFromResult(result: SendResult): SendFailure | null {
  if (result.ok) return null;
  const transient =
    TRANSIENT_RESULT_CODES.has(result.errorCode) || isTransientWahaCode(result.errorCode);
  return transient
    ? { errorCode: result.errorCode, errorMessage: result.errorMessage }
    : null;
}

// ─── Contador durável de tentativas ───────────────────────────────────────────

export interface RecordAttemptInput {
  readonly messageId: string;
  readonly workspaceId: string;
  readonly failure: SendFailure;
}

/**
 * Porta do contador de tentativas de envio. DURÁVEL por contrato (o default
 * grava em `messages.metadata`): um restart do worker no meio da ladder não
 * pode zerar a contagem — senão a mensagem retentaria para sempre.
 */
export interface SendAttemptStore {
  /** Registra mais uma falha transitória e devolve o total de tentativas (≥ 1). */
  record(input: RecordAttemptInput): Promise<number>;
}

/** Resultado terminal sintetizado quando a ladder esgota (vira `failed`). */
export function exhaustedResult(failure: SendFailure, attempts: number): SendResult {
  return {
    ok: false,
    errorCode: failure.errorCode,
    errorMessage: `${failure.errorMessage} (falhou após ${attempts} tentativas)`,
  };
}

export interface TransientFailureContext {
  readonly job: OutboundJob;
  readonly workspaceId: string;
  readonly provider: ChannelProvider;
  readonly failure: SendFailure;
  readonly deps: OutboundDeps;
  readonly logger: Logger;
  readonly attempts: SendAttemptStore;
}

/**
 * Executa a política numa falha transitória:
 *
 * 1. `typing_indicator` não é mensagem persistida — presença é cosmética e
 *    perecível: loga e ack'a (retentar "digitando…" 40 min depois é absurdo).
 * 2. Registra a tentativa (durável) e, se ainda há orçamento, **lança**
 *    {@link TransientSendError} → `consume` republica na wait-queue do próximo
 *    degrau da ladder (a mensagem segue `pending` — a UI mostra "enviando").
 * 3. Esgotado o orçamento, persiste `failed` com o `errorCode` do provider e
 *    retorna normalmente (ack) — falha visível, sem loop e sem DLQ.
 */
export async function handleTransientSendFailure(ctx: TransientFailureContext): Promise<void> {
  const { job, workspaceId, provider, failure, deps, logger, attempts } = ctx;

  const base = {
    kind: job.kind,
    provider,
    conversationId: job.conversationId,
    messageId: job.messageId,
    errorCode: failure.errorCode,
    errorMessage: failure.errorMessage,
  };

  if (job.kind === 'typing_indicator') {
    logger.warn('outbound: presença falhou (transitório) — descartada, sem retry', base);
    return;
  }

  const attempt = await attempts.record({
    messageId: job.messageId,
    workspaceId,
    failure,
  });

  if (attempt >= MAX_SEND_ATTEMPTS) {
    logger.error('outbound: falha transitória esgotou as tentativas → mensagem failed', {
      ...base,
      attempt,
      maxAttempts: MAX_SEND_ATTEMPTS,
    });
    await finalizeOutbound(job, exhaustedResult(failure, attempt), workspaceId, deps);
    return;
  }

  logger.warn('outbound: falha transitória do provider — reprocessando pela ladder durável', {
    ...base,
    attempt,
    maxAttempts: MAX_SEND_ATTEMPTS,
  });
  throw new TransientSendError(failure, attempt, MAX_SEND_ATTEMPTS);
}
