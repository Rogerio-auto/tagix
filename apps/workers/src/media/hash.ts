/**
 * Hash de conteúdo (dedup) + derivação de extensão (F1-S10).
 *
 * O SHA-256 do binário baixado é a chave de dedup: dois envios do mesmo arquivo
 * (mesmo conteúdo) compartilham o objeto no storage — não re-subimos. Também é
 * persistido em `messages.media_sha256` para auditoria e dedup futuro.
 */
import { createHash } from 'node:crypto';
import type { MediaJob } from './job';

/** SHA-256 hex do buffer (chave de dedup + `media_sha256`). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Mapa mínimo MIME → extensão para os tipos de mídia que os canais entregam
 * (WA/IG/WAHA). Conservador: só o que sabemos servir de volta. Desconhecido cai
 * no fallback `bin`.
 */
const MIME_EXT: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

/** Extensão segura (`a-z0-9`, ≤ 8) extraída de um `fileName`, ou `undefined`. */
function extFromFileName(fileName: string | undefined): string | undefined {
  if (fileName === undefined) return undefined;
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return undefined;
  const raw = fileName.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(raw) ? raw : undefined;
}

/** Normaliza um MIME `type/subtype; params` para a chave de lookup. */
function normalizeMime(mime: string | undefined): string | undefined {
  if (mime === undefined) return undefined;
  const base = mime.split(';', 1)[0]?.trim().toLowerCase();
  return base !== undefined && base.length > 0 ? base : undefined;
}

/**
 * Deriva a extensão do objeto a partir do MIME (preferido) ou do `fileName`.
 * Fallback `bin` para conteúdo opaco — a `media_mime` real fica na linha.
 */
export function deriveExtension(job: MediaJob): string {
  const mime = normalizeMime(job.mediaRef.mimeType);
  if (mime !== undefined) {
    const known = MIME_EXT[mime];
    if (known !== undefined) return known;
  }
  return extFromFileName(job.mediaRef.fileName) ?? 'bin';
}

/** MIME efetivo persistido em `media_mime` (fallback genérico). */
export function effectiveMime(job: MediaJob): string {
  return normalizeMime(job.mediaRef.mimeType) ?? 'application/octet-stream';
}
