/**
 * Pipeline do worker de mídia (F1-S10, LIVECHAT.md §3.3; falhas honestas na F70-S27).
 *
 * ```
 * job → resolve canal+adapter+workspace (routing hints)
 *   → findMessage(externalId)            [se sumiu/já tem mídia: skip]
 *   → adapter.downloadMedia(refOrUrl)    → Buffer
 *   → sha256(buffer)                     (chave de dedup + media_sha256)
 *   → dedup: objeto já existe pra esse sha? então NÃO re-sobe (reaproveita key)
 *   → upload R2 `{wsId}/{yyyy}/{mm}/{dd}/{uuid}.{ext}`
 *   → update messages.media_* (withWorkspace → RLS)
 *   → emit message:media_ready (room conversation:{id})
 * ```
 *
 * Idempotência: reprocessar o mesmo job é seguro. Se a mensagem já tem o mesmo
 * `media_sha256`, paramos antes do upload (placeholder já virou mídia). O dedup por
 * conteúdo (mesmo arquivo, mensagens diferentes) reaproveita a key existente.
 *
 * ## Política de falha (F70-S27)
 *
 * Três naturezas, e cada uma tem reação própria:
 *
 * | falha                                       | mensagem                         | job                                   |
 * |---------------------------------------------|----------------------------------|---------------------------------------|
 * | provedor: mídia expirada/indisponível/vazia | `failed` na hora (motivo)        | ack (terminal, nada a retentar)       |
 * | storage de CONFIGURAÇÃO (credencial/bucket) | `failed` = `storage_unavailable` | `deferred`: estaciona com backoff     |
 * |                                             |                                  | longo SEM gastar retentativa          |
 * | transitória (rede, 5xx, banco)              | intacta; `failed` só na última   | lança → escada de retry → DLQ         |
 *
 * Toda falha de storage loga `warn` por tentativa e `error` na tentativa final, com
 * código, operação, bucket e id da mensagem — nunca credencial, URL assinada ou corpo
 * de resposta — e sobe o contador `hm_media_storage_failures_total`.
 *
 * Por que storage negado não gasta retentativas: a escada inteira (5s→30min) cabe em
 * ~40min, e uma credencial revogada leva horas para alguém trocar. Com a escada, o job
 * morria na DLQ antes da correção (6 em retry e 2 na DLQ no incidente de 25/09). Parado
 * no backoff longo, ele se recupera sozinho quando o storage volta.
 */
import type { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { MetaError } from '@hm/channels';
import type { Logger } from '@hm/logger';
import { RETRY_BACKOFF_MS } from '@hm/shared/mq';
import { classifyStorageError, type StorageOperation } from '@hm/storage';
import type { MediaJob } from './job';
import { deriveExtension, effectiveMime, sha256Hex } from './hash';
import {
  defaultMediaRetry,
  type MediaAttemptContext,
  type MediaDeps,
  type MediaFailureReason,
  type MediaMessageTarget,
  type MediaRetryConfig,
  type ResolvedMediaChannel,
  type StoredMediaJob,
} from './ports';

export type { MediaFailureReason } from './ports';

/** Resultado observável do processamento de um job (teste/log/métrica). */
export type MediaPipelineResult =
  | { readonly outcome: 'done'; readonly mediaUrl: string; readonly deduped: boolean }
  | { readonly outcome: 'skipped'; readonly reason: MediaSkipReason }
  | { readonly outcome: 'failed'; readonly reason: MediaFailureReason }
  | {
      /** Storage recusou a credencial: o worker estaciona o job (backoff longo). */
      readonly outcome: 'deferred';
      readonly reason: 'storage_config';
      readonly code: string;
    };

/** Conteúdo "morto" sem mídia a persistir — ack silencioso, sem marcar falha. */
export type MediaSkipReason = 'channel_unresolved' | 'message_not_found' | 'already_ingested';

/** Primeira entrega de um job da fila (default de chamadas diretas). */
const FIRST_ATTEMPT: MediaAttemptContext = { attempt: 0, maxRetries: RETRY_BACKOFF_MS.length };

function skip(reason: MediaSkipReason): MediaPipelineResult {
  return { outcome: 'skipped', reason };
}

/** Key canônica do objeto: `{wsId}/{yyyy}/{mm}/{dd}/{uuid}.{ext}` (UTC). */
export function buildMediaKey(workspaceId: string, ext: string, now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear().toString().padStart(4, '0');
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = now.getUTCDate().toString().padStart(2, '0');
  return `${workspaceId}/${yyyy}/${mm}/${dd}/${randomUUID()}.${ext}`;
}

/** Status HTTP de um erro Meta (para log/métrica), ou `undefined`. */
function metaHttpStatus(err: unknown): number | undefined {
  return err instanceof MetaError ? err.httpStatus : undefined;
}

/** Nome da classe do erro — seguro para log (nunca a mensagem, que pode ecoar dados). */
function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/**
 * Erro de uma operação de storage, marcado com a operação que o originou. O pipeline
 * precisa saber que foi o STORAGE (e não o banco ou o download) para classificar.
 */
class StorageStepError extends Error {
  override readonly name = 'StorageStepError';
  constructor(
    readonly operation: StorageOperation,
    readonly original: unknown,
  ) {
    super(`storage ${operation} falhou`);
  }
}

async function storageStep<T>(operation: StorageOperation, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    throw new StorageStepError(operation, err);
  }
}

/**
 * Resultado do download com retry. `ok` traz o binário; `dead` marca mídia confirmada
 * indisponível pelo provider mesmo após re-resolução (terminal). Erro de infra que
 * persiste é re-lançado (não retorna) para a malha de retry da fila (F52-S03).
 */
type DownloadOutcome =
  | { readonly kind: 'ok'; readonly bytes: Buffer }
  | {
      readonly kind: 'dead';
      readonly reason: 'media_expired' | 'media_unavailable';
      readonly httpStatus: number | undefined;
    };

/** Falha do download que esgotou as tentativas in-process (re-lançada à fila). */
class DownloadStepError extends Error {
  override readonly name = 'DownloadStepError';
  constructor(readonly original: unknown) {
    super('download falhou');
  }
}

/**
 * Baixa a mídia com retry + backoff. Cada tentativa re-invoca o adapter, o que
 * **re-resolve uma URL temporária fresca** quando o `refOrUrl` é um `media_id`
 * (WhatsApp resolve `GET /{media-id}` a cada chamada) — a URL da Meta expira em
 * ~10-30s. Esgotadas as tentativas:
 *  - erro de provider não-retryável ⇒ `dead` (terminal: marca `failed`). 404/410 é a
 *    mídia expirada na Meta (`media_expired`); o resto, `media_unavailable`;
 *  - erro transitório (5xx/rede) ⇒ re-lança ⇒ escada de retry da fila.
 */
async function downloadWithRetry(
  job: MediaJob,
  resolved: ResolvedMediaChannel,
  retry: MediaRetryConfig,
  logger: Logger,
): Promise<DownloadOutcome> {
  const maxAttempts = Math.max(1, retry.maxAttempts);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const bytes = await resolved.adapter.downloadMedia(job.mediaRef.refOrUrl, resolved.channel);
      if (attempt > 1) {
        logger.info('media: download recuperado após retry', {
          externalId: job.externalId,
          provider: job.provider,
          attempt,
        });
      }
      return { kind: 'ok', bytes };
    } catch (err: unknown) {
      lastErr = err;
      const isLast = attempt >= maxAttempts;
      logger.warn('media: download falhou', {
        externalId: job.externalId,
        provider: job.provider,
        attempt,
        maxAttempts,
        httpStatus: metaHttpStatus(err),
        retryable: err instanceof MetaError ? err.retryable : true,
        isLast,
      });
      if (isLast) break;
      const delayMs = retry.backoffMs[attempt - 1] ?? retry.backoffMs.at(-1) ?? 0;
      await retry.sleep(delayMs);
    }
  }

  if (lastErr instanceof MetaError && !lastErr.retryable) {
    const expired = lastErr.httpStatus === 404 || lastErr.httpStatus === 410;
    return {
      kind: 'dead',
      reason: expired ? 'media_expired' : 'media_unavailable',
      httpStatus: lastErr.httpStatus,
    };
  }
  throw new DownloadStepError(lastErr);
}

/** Job enxuto a guardar na mensagem em falha (base do reprocessamento). */
function storedJob(job: MediaJob): StoredMediaJob {
  return {
    provider: job.provider,
    externalId: job.externalId,
    mediaRef: job.mediaRef,
    routing: job.routing,
  };
}

/**
 * Processa um único job de mídia (testável sem RabbitMQ — todas as saídas são portas
 * injetáveis). Lança só em falha transitória (a fila retenta); storage negado devolve
 * `deferred`; conteúdo morto devolve `skipped`/`failed`.
 */
export async function runMediaPipeline(
  job: MediaJob,
  deps: MediaDeps,
  logger: Logger,
  ctx: MediaAttemptContext = FIRST_ATTEMPT,
): Promise<MediaPipelineResult> {
  // 1) Resolve canal → workspace pelas routing hints (cross-tenant lookup).
  const resolved = await deps.channels.resolve(job.provider, job.routing);
  if (resolved === null) {
    logger.warn('media: canal não resolvido — descartado', {
      provider: job.provider,
      externalId: job.externalId,
    });
    return skip('channel_unresolved');
  }
  const { workspaceId } = resolved;

  // 2) Localiza a mensagem-alvo (RLS). Sem mensagem ⇒ órfã; ack silencioso (desde a
  //    F70-S21 o job só existe se a mensagem foi commitada junto).
  const target = await deps.persistence.findMessage(workspaceId, job.externalId);
  if (target === null) {
    logger.warn('media: mensagem-alvo inexistente — descartado', {
      workspaceId,
      externalId: job.externalId,
    });
    return skip('message_not_found');
  }

  try {
    return await ingest(job, deps, logger, resolved, target);
  } catch (err: unknown) {
    return handleFailure(err, { job, deps, logger, ctx, workspaceId, target });
  }
}

/** Passos 3-7: download → sha → dedup → upload → persiste → emite. */
async function ingest(
  job: MediaJob,
  deps: MediaDeps,
  logger: Logger,
  resolved: ResolvedMediaChannel,
  target: MediaMessageTarget,
): Promise<MediaPipelineResult> {
  const { workspaceId } = resolved;
  const retry = deps.retry ?? defaultMediaRetry;
  const fail = (reason: MediaFailureReason, code?: string): Promise<MediaPipelineResult> =>
    markFailed({ job, deps, logger, workspaceId, target, reason, code });

  // 3) Marca o download em voo (`downloading`) e baixa com retry/re-resolve.
  await deps.persistence.markStatus(workspaceId, target.messageId, 'downloading');
  const download = await downloadWithRetry(job, resolved, retry, logger);
  if (download.kind === 'dead') {
    return fail(
      download.reason,
      download.httpStatus !== undefined ? `Http${download.httpStatus}` : undefined,
    );
  }
  const bytes = download.bytes;
  if (bytes.length === 0) return fail('empty_media');

  // 4) SHA-256 (chave de dedup + media_sha256).
  const sha256 = sha256Hex(bytes);

  // Idempotência: a mensagem já foi ingerida com este conteúdo → nada a fazer.
  if (target.existingSha256 === sha256) {
    await deps.persistence.markStatus(workspaceId, target.messageId, 'ready');
    logger.info('media: mensagem já ingerida (mesmo sha) — no-op', {
      workspaceId,
      messageId: target.messageId,
    });
    return skip('already_ingested');
  }

  // 5) Dedup por conteúdo: se já subimos esse sha (outra mensagem), reaproveita a key.
  const ext = deriveExtension(job);
  const mime = effectiveMime(job);
  const existingKey = await deps.persistence.findKeyBySha256(workspaceId, sha256);

  let key: string;
  let deduped: boolean;
  if (
    existingKey !== null &&
    (await storageStep('head', () => deps.storage.objectExists(existingKey)))
  ) {
    key = existingKey;
    deduped = true;
  } else {
    key = buildMediaKey(workspaceId, ext);
    const uploadKey = key;
    await storageStep('put', () =>
      deps.storage.upload({ key: uploadKey, body: bytes, contentType: mime }),
    );
    deduped = false;
  }

  // 6) URL servível + persistência de `messages.media_*` (RLS). Limpa a falha anterior.
  const finalKey = key;
  const mediaUrl = await storageStep('sign', () => deps.storage.publicUrl(finalKey));
  await deps.persistence.update({
    workspaceId,
    messageId: target.messageId,
    mediaUrl,
    mediaMime: mime,
    mediaSizeBytes: bytes.length,
    mediaSha256: sha256,
    mediaKey: key,
    mediaStatus: 'ready',
  });

  // 7) Emite `message:media_ready` (placeholder/erro vira mídia carregada na UI).
  await deps.socket.emitMediaReady({
    workspaceId,
    conversationId: target.conversationId,
    messageId: target.messageId,
    mediaUrl,
  });

  logger.info('media: ingerida', {
    workspaceId,
    messageId: target.messageId,
    sizeBytes: bytes.length,
    deduped,
    recovered: target.currentFailureReason !== null && target.currentFailureReason !== undefined,
  });

  return { outcome: 'done', mediaUrl, deduped };
}

interface FailureScope {
  readonly job: MediaJob;
  readonly deps: MediaDeps;
  readonly logger: Logger;
  readonly workspaceId: string;
  readonly target: MediaMessageTarget;
}

/**
 * Grava a falha na mensagem (status + motivo + job), conta e avisa a tela. O
 * `media_failed` só sai na TRANSIÇÃO de motivo: um job estacionado volta a cada 30min
 * e não pode repintar a bolha nem inflar a métrica a cada volta.
 */
async function markFailed(
  scope: FailureScope & { readonly reason: MediaFailureReason; readonly code?: string | undefined },
): Promise<MediaPipelineResult> {
  const { deps, logger, workspaceId, target, reason, code } = scope;
  await deps.persistence.markFailed({
    workspaceId,
    messageId: target.messageId,
    reason,
    code,
    job: storedJob(scope.job),
  });
  if (target.currentFailureReason !== reason) {
    deps.metrics?.mediaFailed(reason);
    await deps.socket.emitMediaFailed({
      workspaceId,
      conversationId: target.conversationId,
      messageId: target.messageId,
      reason,
    });
  }
  logger.warn('media: falha registrada na mensagem', {
    workspaceId,
    messageId: target.messageId,
    reason,
    code,
  });
  return { outcome: 'failed', reason };
}

/**
 * Trata a falha de `ingest`. Storage de configuração ⇒ `deferred` (sem lançar).
 * Qualquer outra ⇒ loga (`warn` por tentativa, `error` na última), marca `failed` na
 * última e RE-LANÇA para a escada de retry da fila.
 */
async function handleFailure(
  err: unknown,
  scope: FailureScope & { readonly ctx: MediaAttemptContext },
): Promise<MediaPipelineResult> {
  const { deps, logger, workspaceId, target, ctx, job } = scope;
  const isFinal = ctx.attempt >= ctx.maxRetries;
  const base = {
    workspaceId,
    messageId: target.messageId,
    externalId: job.externalId,
    provider: job.provider,
    attempt: ctx.attempt + 1,
    maxAttempts: ctx.maxRetries + 1,
  };

  if (err instanceof StorageStepError) {
    const info = classifyStorageError(err.original);
    const bucket = readBucket(err.original);
    const fields = {
      ...base,
      storageOperation: err.operation,
      storageCode: info.code,
      storageKind: info.kind,
      httpStatus: info.httpStatus,
      bucket,
    };
    deps.metrics?.storageFailure(info.kind, info.code, err.operation);

    if (info.kind === 'config') {
      // Não gasta retentativa: o worker estaciona o job. `warn` por volta — o alarme
      // (health + métrica) é quem acorda alguém, não a repetição do log.
      logger.warn(
        'media: storage recusou a credencial — falha de configuração, job estacionado até a correção',
        fields,
      );
      await markFailed({ ...scope, reason: 'storage_unavailable', code: info.code });
      return { outcome: 'deferred', reason: 'storage_config', code: info.code };
    }

    if (isFinal) {
      logger.error('media: storage falhou na última tentativa — mídia marcada como falha', fields);
      await markFailedBestEffort(scope, 'storage_error', info.code);
    } else {
      logger.warn('media: storage falhou — nova tentativa pela fila', fields);
    }
    throw err.original;
  }

  const original = err instanceof DownloadStepError ? err.original : err;
  const reason: MediaFailureReason =
    err instanceof DownloadStepError ? 'download_error' : 'processing_error';
  const fields = {
    ...base,
    reason,
    errorName: errorName(original),
    httpStatus: metaHttpStatus(original),
  };
  if (isFinal) {
    logger.error('media: falha na última tentativa — mídia marcada como falha', fields);
    await markFailedBestEffort(scope, reason, undefined);
  } else {
    logger.warn('media: falha transitória — nova tentativa pela fila', fields);
  }
  throw original;
}

/** Na última tentativa, marcar `failed` é melhor esforço: o erro original manda. */
async function markFailedBestEffort(
  scope: FailureScope,
  reason: MediaFailureReason,
  code: string | undefined,
): Promise<void> {
  try {
    await markFailed({ ...scope, reason, code });
  } catch (markErr: unknown) {
    scope.logger.error('media: não foi possível registrar a falha na mensagem', {
      workspaceId: scope.workspaceId,
      messageId: scope.target.messageId,
      errorName: errorName(markErr),
    });
  }
}

/** Bucket do `StorageError` (campo público, sem segredo), se houver. */
function readBucket(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const bucket: unknown = Reflect.get(err, 'bucket');
  return typeof bucket === 'string' ? bucket : undefined;
}
