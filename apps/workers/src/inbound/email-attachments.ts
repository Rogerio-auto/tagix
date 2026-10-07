/**
 * Anexo de e-mail recebido → objeto no R2 (F60-S10).
 *
 * O caminho espelha a mídia da Meta (F1-S10): o binário vai para o storage sob
 * `{wsId}/{yyyy}/{mm}/{dd}/{uuid}.{ext}`, a mensagem guarda a key estável em
 * `metadata.mediaKey` (é dela que `refresh-media-url` reidrata a URL assinada
 * quando os 7 dias vencem) e nasce `media_status = ready`.
 *
 * A diferença é a origem. A mídia da Meta passou pelo filtro da Meta; o anexo de
 * e-mail é um arquivo qualquer que um desconhecido escolheu, com nome e tipo que
 * ele mesmo declarou. Por isso a política aqui é **lista de permissão** — a mesma
 * filosofia do sanitizador de HTML (F60-S08) e do bloqueio de SVG do `uploads.ts`:
 *
 * - o tipo precisa estar na lista (documento, imagem, áudio, vídeo comuns);
 * - extensão executável, script, HTML, SVG e Office com macro são recusados
 *   mesmo que o `Content-Type` diga outra coisa;
 * - os **bytes** são conferidos: PDF que não começa com `%PDF`, imagem sem a
 *   assinatura da imagem, executável disfarçado ou marcação HTML/SVG dentro de
 *   um "documento" são recusados.
 *
 * Anexo recusado não some: vira registro na mensagem (`rejectedAttachments`),
 * para o atendente saber que o cliente mandou algo e pedir de outro jeito.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { buildMediaKey } from '../media/pipeline';
import type { MediaStoragePort } from '../media/ports';
import type { AttachmentFetcher, AttachmentFetchFailure } from './email-attachment-fetch';

/** Tetos. Os mesmos do envio (`EMAIL_CAPABILITIES.maxAttachmentBytes`). */
export const EMAIL_ATTACHMENT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxCount: 20,
  maxTotalBytes: 25 * 1024 * 1024,
  fetchTimeoutMs: 30_000,
} as const;

/** Tipo de mensagem que o anexo vira na conversa. */
export type AttachmentMessageType = 'image' | 'video' | 'audio' | 'document';

/** Assinatura de bytes esperada por tipo (quando o formato tem uma confiável). */
type Magic = 'jpeg' | 'png' | 'gif' | 'webp' | 'pdf' | 'zip' | 'ole' | 'text' | 'any';

interface AllowedType {
  readonly ext: string;
  readonly messageType: AttachmentMessageType;
  readonly magic: Magic;
}

/** Lista de permissão. O que não está aqui não entra. */
const ALLOWED: Readonly<Record<string, AllowedType>> = {
  'image/jpeg': { ext: 'jpg', messageType: 'image', magic: 'jpeg' },
  'image/png': { ext: 'png', messageType: 'image', magic: 'png' },
  'image/gif': { ext: 'gif', messageType: 'image', magic: 'gif' },
  'image/webp': { ext: 'webp', messageType: 'image', magic: 'webp' },
  'video/mp4': { ext: 'mp4', messageType: 'video', magic: 'any' },
  'video/quicktime': { ext: 'mov', messageType: 'video', magic: 'any' },
  'audio/mpeg': { ext: 'mp3', messageType: 'audio', magic: 'any' },
  'audio/ogg': { ext: 'ogg', messageType: 'audio', magic: 'any' },
  'audio/mp4': { ext: 'm4a', messageType: 'audio', magic: 'any' },
  'audio/aac': { ext: 'aac', messageType: 'audio', magic: 'any' },
  'application/pdf': { ext: 'pdf', messageType: 'document', magic: 'pdf' },
  'application/msword': { ext: 'doc', messageType: 'document', magic: 'ole' },
  'application/vnd.ms-excel': { ext: 'xls', messageType: 'document', magic: 'ole' },
  'application/vnd.ms-powerpoint': { ext: 'ppt', messageType: 'document', magic: 'ole' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    ext: 'docx',
    messageType: 'document',
    magic: 'zip',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    ext: 'xlsx',
    messageType: 'document',
    magic: 'zip',
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    ext: 'pptx',
    messageType: 'document',
    magic: 'zip',
  },
  'application/vnd.oasis.opendocument.text': { ext: 'odt', messageType: 'document', magic: 'zip' },
  'application/vnd.oasis.opendocument.spreadsheet': {
    ext: 'ods',
    messageType: 'document',
    magic: 'zip',
  },
  'text/plain': { ext: 'txt', messageType: 'document', magic: 'text' },
  'text/csv': { ext: 'csv', messageType: 'document', magic: 'text' },
};

/** Extensão → tipo, para quando o remetente manda `application/octet-stream`. */
const MIME_BY_EXT: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ALLOWED).map(([mime, t]) => [t.ext, mime]),
);
// Sinônimos comuns.
const EXT_ALIASES: Readonly<Record<string, string>> = { jpeg: 'jpg', text: 'txt' };

/**
 * Extensões recusadas qualquer que seja o `Content-Type` declarado: executáveis,
 * scripts, atalhos, imagens de disco, documentos que o navegador executa
 * (HTML/SVG/XML) e Office com macro.
 */
const BLOCKED_EXT = new Set([
  'exe',
  'dll',
  'com',
  'scr',
  'pif',
  'cpl',
  'msi',
  'msp',
  'bat',
  'cmd',
  'ps1',
  'psm1',
  'vbs',
  'vbe',
  'js',
  'jse',
  'mjs',
  'wsf',
  'wsh',
  'hta',
  'jar',
  'lnk',
  'reg',
  'sh',
  'bash',
  'app',
  'dmg',
  'pkg',
  'iso',
  'img',
  'vhd',
  'html',
  'htm',
  'xhtml',
  'shtml',
  'svg',
  'svgz',
  'xml',
  'xsl',
  'docm',
  'dotm',
  'xlsm',
  'xltm',
  'xlam',
  'pptm',
  'potm',
  'ppam',
  'apk',
  'appx',
]);

/** Por que um anexo não virou mídia. */
export type AttachmentRejection =
  | AttachmentFetchFailure
  | 'blocked_type'
  | 'unsupported_type'
  | 'content_mismatch'
  | 'empty'
  | 'too_many'
  | 'total_too_large'
  | 'storage_error';

/** Anexo como o worker o recebe (já validado pelo Zod de `email-inbound.ts`). */
export type IncomingEmailAttachment =
  | {
      readonly kind: 'inline';
      readonly filename: string;
      readonly contentType: string;
      readonly contentId: string | null;
      readonly contentBase64: string;
      readonly sizeBytes: number;
    }
  | {
      readonly kind: 'remote';
      readonly filename: string;
      readonly contentType: string;
      readonly contentId: string | null;
      readonly url: string;
      readonly sizeBytes: number | null;
    };

/** Anexo aceito e já no storage, pronto para virar mensagem. */
export interface StoredEmailAttachment {
  readonly index: number;
  readonly filename: string;
  readonly contentId: string | null;
  readonly messageType: AttachmentMessageType;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly key: string;
  readonly mediaUrl: string;
}

export interface RejectedEmailAttachment {
  readonly index: number;
  readonly filename: string;
  readonly reason: AttachmentRejection;
}

export interface IngestedAttachments {
  readonly stored: readonly StoredEmailAttachment[];
  readonly rejected: readonly RejectedEmailAttachment[];
}

// ─── Política (pura) ─────────────────────────────────────────────────────────

function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXT_ALIASES[ext] ?? ext;
}

function baseMime(contentType: string): string {
  return (contentType.split(';', 1)[0] ?? '').trim().toLowerCase();
}

export type AttachmentClassification =
  | { readonly ok: true; readonly mime: string; readonly type: AllowedType }
  | { readonly ok: false; readonly reason: 'blocked_type' | 'unsupported_type' };

/**
 * Decide, pelo que foi DECLARADO (nome + tipo), se o anexo pode entrar.
 *
 * Qualquer extensão bloqueada no nome recusa — inclusive a dupla extensão
 * `fatura.pdf.exe`, que é a forma mais comum de disfarce. Extensão e tipo
 * declarado precisam concordar quando os dois existem: `foto.jpg` declarado como
 * `application/pdf` é recusado, porque um dos dois está mentindo.
 */
export function classifyAttachment(
  filename: string,
  contentType: string,
): AttachmentClassification {
  const partes = filename.toLowerCase().split('.').slice(1);
  if (partes.some((p) => BLOCKED_EXT.has(p))) return { ok: false, reason: 'blocked_type' };

  const ext = extensionOf(filename);
  let mime = baseMime(contentType);
  if (mime === '' || mime === 'application/octet-stream') {
    mime = ext !== null ? (MIME_BY_EXT[ext] ?? '') : '';
  }
  const type = ALLOWED[mime];
  if (type === undefined) return { ok: false, reason: 'unsupported_type' };
  if (ext !== null && MIME_BY_EXT[ext] !== undefined && MIME_BY_EXT[ext] !== mime) {
    return { ok: false, reason: 'unsupported_type' };
  }
  return { ok: true, mime, type };
}

function startsWith(bytes: Buffer, assinatura: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + assinatura.length) return false;
  return assinatura.every((b, i) => bytes[offset + i] === b);
}

/** Executável nativo ou script com shebang. Nunca é anexo legítimo de atendimento. */
function looksExecutable(bytes: Buffer): boolean {
  return (
    startsWith(bytes, [0x4d, 0x5a]) || // MZ — PE (Windows)
    startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]) || // ELF
    startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe]) || // Mach-O 64
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe]) || // Mach-O universal / classe Java
    startsWith(bytes, [0x23, 0x21]) // #!
  );
}

/** Marcação que o navegador renderiza (HTML/SVG/XML). Mesma heurística do `uploads.ts`. */
function looksLikeMarkup(bytes: Buffer): boolean {
  let i = 0;
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) i = 3;
  while (
    i < bytes.length &&
    (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)
  ) {
    i += 1;
  }
  const head = bytes.toString('latin1', i, Math.min(bytes.length, i + 1024)).toLowerCase();
  return (
    head.startsWith('<?xml') ||
    head.startsWith('<!doctype') ||
    head.startsWith('<html') ||
    head.startsWith('<svg') ||
    head.startsWith('<script') ||
    head.includes('<svg') ||
    head.includes('<script')
  );
}

function magicMatches(bytes: Buffer, magic: Magic): boolean {
  switch (magic) {
    case 'jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'gif':
      return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]);
    case 'webp':
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
      );
    case 'pdf':
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]);
    case 'zip':
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case 'ole':
      return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'text':
    case 'any':
      return true;
    default:
      return false;
  }
}

/**
 * Confere os BYTES contra o tipo aceito. O remetente controla nome e
 * `Content-Type`; só o conteúdo diz o que o arquivo é.
 */
export function inspectAttachmentBytes(
  bytes: Buffer,
  type: AllowedType,
): { readonly ok: true } | { readonly ok: false; readonly reason: 'empty' | 'content_mismatch' } {
  if (bytes.length === 0) return { ok: false, reason: 'empty' };
  if (looksExecutable(bytes)) return { ok: false, reason: 'content_mismatch' };
  if (looksLikeMarkup(bytes)) return { ok: false, reason: 'content_mismatch' };
  if (!magicMatches(bytes, type.magic)) return { ok: false, reason: 'content_mismatch' };
  return { ok: true };
}

// ─── Ingestão (IO por porta) ─────────────────────────────────────────────────

export interface IngestAttachmentsDeps {
  readonly storage: Pick<MediaStoragePort, 'upload' | 'publicUrl'>;
  readonly fetchRemote: AttachmentFetcher;
  /** Relógio injetável (a key leva a data). */
  readonly now?: () => Date;
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Base64 estrito (o Zod já validou o formato; isto só decodifica). */
function decodeBase64(b64: string): Buffer {
  return Buffer.from(b64, 'base64');
}

/**
 * Valida, busca (se remoto, com guarda anti-SSRF) e sobe cada anexo para o
 * storage. Nunca lança por causa de UM anexo: cada falha vira registro em
 * `rejected`, e o e-mail segue sendo entregue na conversa.
 */
export async function ingestEmailAttachments(
  workspaceId: string,
  attachments: readonly IncomingEmailAttachment[],
  deps: IngestAttachmentsDeps,
): Promise<IngestedAttachments> {
  const stored: StoredEmailAttachment[] = [];
  const rejected: RejectedEmailAttachment[] = [];
  const now = deps.now ?? (() => new Date());
  let total = 0;

  for (let index = 0; index < attachments.length; index += 1) {
    const a = attachments[index];
    if (a === undefined) continue;
    const recusa = (reason: AttachmentRejection): void => {
      rejected.push({ index, filename: a.filename, reason });
    };

    if (index >= EMAIL_ATTACHMENT_LIMITS.maxCount) {
      recusa('too_many');
      continue;
    }

    const classe = classifyAttachment(a.filename, a.contentType);
    if (!classe.ok) {
      recusa(classe.reason);
      continue;
    }

    // Recusa antecipada pelo tamanho anunciado: não abre conexão à toa.
    const anunciado = a.sizeBytes;
    if (anunciado !== null && anunciado > EMAIL_ATTACHMENT_LIMITS.maxBytes) {
      recusa('too_large');
      continue;
    }

    let bytes: Buffer;
    if (a.kind === 'inline') {
      bytes = decodeBase64(a.contentBase64);
    } else {
      const r = await deps.fetchRemote(a.url, {
        maxBytes: EMAIL_ATTACHMENT_LIMITS.maxBytes,
        timeoutMs: EMAIL_ATTACHMENT_LIMITS.fetchTimeoutMs,
      });
      if (!r.ok) {
        recusa(r.reason);
        continue;
      }
      bytes = r.bytes;
    }

    if (bytes.length > EMAIL_ATTACHMENT_LIMITS.maxBytes) {
      recusa('too_large');
      continue;
    }
    if (total + bytes.length > EMAIL_ATTACHMENT_LIMITS.maxTotalBytes) {
      recusa('total_too_large');
      continue;
    }

    const inspecao = inspectAttachmentBytes(bytes, classe.type);
    if (!inspecao.ok) {
      recusa(inspecao.reason);
      continue;
    }

    const key = buildMediaKey(workspaceId, classe.type.ext, now());
    let mediaUrl: string;
    try {
      await deps.storage.upload({ key, body: bytes, contentType: classe.mime });
      mediaUrl = await deps.storage.publicUrl(key);
    } catch {
      // Storage fora não pode custar o e-mail: o texto entra, o anexo fica
      // registrado como não armazenado. (O erro detalhado é do driver — o
      // chamador loga o motivo curto, nunca credencial ou URL assinada.)
      recusa('storage_error');
      continue;
    }

    total += bytes.length;
    stored.push({
      index,
      filename: a.filename,
      contentId: a.contentId,
      messageType: classe.type.messageType,
      mime: classe.mime,
      sizeBytes: bytes.length,
      sha256: sha256Hex(bytes),
      key,
      mediaUrl,
    });
  }

  return { stored, rejected };
}
