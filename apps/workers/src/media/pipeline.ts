/**
 * Pipeline do worker de mídia (F1-S10, LIVECHAT.md §3.3).
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
 * `media_sha256`, paramos antes do download (placeholder já virou mídia). O
 * dedup por conteúdo (mesmo arquivo, mensagens diferentes) reaproveita a key
 * existente — sem segundo upload.
 *
 * Política de erro (alinhada a inbound/outbound): conteúdo "morto" — canal não
 * resolvido, mensagem inexistente, mídia indisponível no provider — NÃO lança
 * (loga-warn e retorna `skipped`/`failed`): reprocessar um payload imutável não
 * ajuda, e o job é ack'd. Só falha de **infra** (storage/DB/socket) propaga →
 * nack → DLX.
 */
import type { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { MetaError } from '@hm/channels';
import type { Logger } from '@hm/logger';
import type { MediaJob } from './job';
import { deriveExtension, effectiveMime, sha256Hex } from './hash';
import { defaultMediaRetry, type MediaDeps, type MediaRetryConfig, type ResolvedMediaChannel } from './ports';

/** Resultado observável do processamento de um job (teste/log/métrica). */
export type MediaPipelineResult =
  | { readonly outcome: 'done'; readonly mediaUrl: string; readonly deduped: boolean }
  | { readonly outcome: 'skipped'; readonly reason: MediaSkipReason }
  | { readonly outcome: 'failed'; readonly reason: MediaFailureReason };

/** Conteúdo "morto" sem mídia a persistir — ack silencioso, sem marcar falha. */
export type MediaSkipReason = 'channel_unresolved' | 'message_not_found' | 'already_ingested';

/** Falha terminal de mídia: `media_status='failed'` + evento `media_failed`. */
export type MediaFailureReason = 'media_unavailable' | 'empty_media';

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

/**
 * Resultado do download com retry. `ok` traz o binário; `dead` marca mídia
 * confirmada indisponível pelo provider mesmo após re-resolução (terminal —
 * retentar pela malha MQ não ajuda). Erro de infra que persiste é re-lançado
 * (não retorna) para a malha DLX/retry (F52-S03) cuidar do job inteiro.
 */
type DownloadOutcome = { readonly kind: 'ok'; readonly bytes: Buffer } | { readonly kind: 'dead' };

/**
 * Baixa a mídia com retry + backoff. Cada tentativa re-invoca o adapter, o que
 * **re-resolve uma URL temporária fresca** quando o `refOrUrl` é um `media_id`
 * (WhatsApp resolve `GET /{media-id}` a cada chamada) — atacando direto a causa
 * raiz (URL da Meta expira em ~10-30s). Esgotadas as tentativas:
 *  - erro de provider não-retryável (404/ref expirada que não re-resolveu) ⇒
 *    `dead` (terminal: marca `failed`, sem reprocessar pela MQ);
 *  - erro transitório (5xx/rede) ⇒ re-lança ⇒ malha DLX/retry reprocessa o job
 *    (e re-resolve de novo numa janela maior).
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

  // Tentativas esgotadas. Provider confirmou mídia morta (não-retryável)? Terminal.
  if (lastErr instanceof MetaError && !lastErr.retryable) return { kind: 'dead' };
  // Infra transitória que persistiu além da janela in-process → malha DLX/retry.
  throw lastErr;
}

/**
 * Processa um único job de mídia (testável sem RabbitMQ — todas as saídas são
 * portas injetáveis). Lança apenas em falha de infra; conteúdo morto retorna
 * `skipped`.
 */
export async function runMediaPipeline(
  job: MediaJob,
  deps: MediaDeps,
  logger: Logger,
): Promise<MediaPipelineResult> {
  const retry = deps.retry ?? defaultMediaRetry;

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

  // 2) Localiza a mensagem-alvo (RLS). Sem mensagem ⇒ ainda não persistida ou
  //    órfã; ack silencioso (a borda do inbound persiste de forma assíncrona —
  //    se o media chegou antes, o reprocesso por DLX/retry casa depois).
  const target = await deps.persistence.findMessage(workspaceId, job.externalId);
  if (target === null) {
    logger.warn('media: mensagem-alvo inexistente — descartado', {
      workspaceId,
      externalId: job.externalId,
    });
    return skip('message_not_found');
  }

  /** Marca a mídia como falha definitiva (status + evento) e devolve o resultado. */
  const fail = async (reason: MediaFailureReason): Promise<MediaPipelineResult> => {
    await deps.persistence.markStatus(workspaceId, target.messageId, 'failed');
    await deps.socket.emitMediaFailed({
      workspaceId,
      conversationId: target.conversationId,
      messageId: target.messageId,
      reason,
    });
    logger.warn('media: falha definitiva', {
      workspaceId,
      messageId: target.messageId,
      reason,
    });
    return { outcome: 'failed', reason };
  };

  // 3) Marca o download em voo (`downloading`) e baixa com retry/re-resolve.
  await deps.persistence.markStatus(workspaceId, target.messageId, 'downloading');
  const download = await downloadWithRetry(job, resolved, retry, logger);
  if (download.kind === 'dead') return fail('media_unavailable');
  const bytes = download.bytes;
  if (bytes.length === 0) return fail('empty_media');

  // 4) SHA-256 (chave de dedup + media_sha256).
  const sha256 = sha256Hex(bytes);

  // Idempotência: a mensagem já foi ingerida com este conteúdo → nada a fazer.
  // Restaura `ready` (o `downloading` acima foi transitório num reprocesso).
  if (target.existingSha256 === sha256) {
    await deps.persistence.markStatus(workspaceId, target.messageId, 'ready');
    logger.info('media: mensagem já ingerida (mesmo sha) — no-op', {
      workspaceId,
      messageId: target.messageId,
    });
    return skip('already_ingested');
  }

  // 5) Dedup por conteúdo: se já subimos esse sha (outra mensagem), reaproveita
  //    a key existente — sem segundo upload. Senão, sobe sob a key canônica.
  const ext = deriveExtension(job);
  const mime = effectiveMime(job);
  const existingKey = await deps.persistence.findKeyBySha256(workspaceId, sha256);

  let key: string;
  let deduped: boolean;
  if (existingKey !== null && (await deps.storage.objectExists(existingKey))) {
    key = existingKey;
    deduped = true;
  } else {
    key = buildMediaKey(workspaceId, ext);
    await deps.storage.upload({ key, body: bytes, contentType: mime });
    deduped = false;
  }

  // 6) URL servível + persistência de `messages.media_*` (RLS).
  const mediaUrl = await deps.storage.publicUrl(key);
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

  // 7) Emite `message:media_ready` (placeholder vira mídia carregada na UI).
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
  });

  return { outcome: 'done', mediaUrl, deduped };
}
