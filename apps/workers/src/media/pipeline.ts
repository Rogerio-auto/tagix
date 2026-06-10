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
import type { MediaDeps, ResolvedMediaChannel } from './ports';

/** Resultado observável do processamento de um job (teste/log/métrica). */
export type MediaPipelineResult =
  | { readonly outcome: 'done'; readonly mediaUrl: string; readonly deduped: boolean }
  | { readonly outcome: 'skipped'; readonly reason: MediaSkipReason };

export type MediaSkipReason =
  | 'channel_unresolved'
  | 'message_not_found'
  | 'already_ingested'
  | 'media_unavailable'
  | 'empty_media';

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

/** Baixa a mídia; mídia indisponível no provider (404/expirada) vira `null`. */
async function tryDownload(
  job: MediaJob,
  resolved: ResolvedMediaChannel,
  logger: Logger,
): Promise<Buffer | null> {
  try {
    return await resolved.adapter.downloadMedia(job.mediaRef.refOrUrl, resolved.channel);
  } catch (err: unknown) {
    // Erro de provider não-retryável (ref expirada/inexistente): conteúdo morto.
    if (err instanceof MetaError && !err.retryable) {
      logger.warn('media: download falhou (provider, não-retryável) — descartado', {
        externalId: job.externalId,
        provider: job.provider,
        errorCode: err.httpStatus,
      });
      return null;
    }
    // Demais erros (rede/5xx/timeout): infra → propaga para nack→DLX (retry).
    throw err;
  }
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

  // 3) Download via adapter (resolve media_id→URL temporária quando preciso).
  const bytes = await tryDownload(job, resolved, logger);
  if (bytes === null) return skip('media_unavailable');
  if (bytes.length === 0) {
    logger.warn('media: binário vazio — descartado', {
      workspaceId,
      externalId: job.externalId,
    });
    return skip('empty_media');
  }

  // 4) SHA-256 (chave de dedup + media_sha256).
  const sha256 = sha256Hex(bytes);

  // Idempotência: a mensagem já foi ingerida com este conteúdo → nada a fazer.
  if (target.existingSha256 === sha256) {
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
