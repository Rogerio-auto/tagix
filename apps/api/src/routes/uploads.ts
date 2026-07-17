/**
 * Upload de mídia do LiveChat (outbound). Recebe o ARQUIVO cru, normaliza quando
 * pedido (voz→ogg/opus, sticker→webp 512²), sobe no storage (R2/local) e devolve a
 * URL assinada de leitura — que vira a `mediaUrl` da mensagem (o WhatsApp busca via
 * `link` no envio; ver whatsapp/serializer.ts).
 *
 *   POST /api/uploads?filename=<nome>&as=<voice|sticker|auto>  body=<bytes>
 *     → { fileUrl, key, mime }
 *
 * O parâmetro `as` declara a INTENÇÃO (F45-S01):
 *   - `voice`   + áudio  → transcode ffmpeg p/ `audio/ogg;codecs=opus` (nota de voz nativa);
 *   - `sticker` + imagem → conversão sharp p/ `image/webp` 512² ≤100 KB;
 *   - `auto` (default)   → passthrough (comportamento legado).
 * `mime` na resposta reflete o formato APÓS a normalização.
 *
 * Server-side (cliente → API → R2): não exige CORS de R2 nem presign de PUT (o
 * driver só expõe GET assinado). `express.raw` é por-rota — o `express.json` global
 * pula (content-type não-json), então o stream chega intacto. Gate por
 * `conversation.assign` (STAFF — mesmo critério de enviar mensagem). Allowlist de
 * tipo + teto de tamanho + key sanitizada por workspace (sem path traversal).
 */
import express, { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { createStorage } from '@hm/storage';
import { requireAuth, requireRole, withRLS } from '../middlewares/auth';
import {
  MediaTranscodeError,
  MediaUnsupportedError,
  toStickerWebp,
  transcodeToOpusOgg,
} from '../media';

/** Teto de upload (cobre imagem/vídeo/áudio do WhatsApp com folga). */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** TTL da URL de leitura — 7 dias, igual à mídia inbound (a UI reidrata via REST). */
const MEDIA_READ_TTL_SECONDS = 7 * 24 * 60 * 60;

const ALLOWED_TYPE_PREFIXES = ['image/', 'video/', 'audio/'] as const;
const ALLOWED_TYPES_EXACT = new Set(['application/pdf']);

/**
 * SVG é um documento XML — pode embutir `<script>`/`onload`, então serve como vetor
 * de XSS armazenado se o browser o renderizar inline a partir do nosso domínio/CDN.
 * Bloqueamos o mime declarado E o conteúdo real (o cliente controla o `Content-Type`).
 */
const SVG_MIME = 'image/svg+xml';

/** Família de mídia derivada dos bytes reais (não do header do cliente). */
type MediaCategory = 'image' | 'video' | 'audio' | 'pdf';

/** Categoria declarada pelo `Content-Type` (já normalizado, sem params). */
function declaredCategory(contentType: string): MediaCategory | null {
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('audio/')) return 'audio';
  return null;
}

/**
 * Heurística de detecção de SVG/XML por conteúdo: pula BOM UTF-8 + espaços iniciais
 * e verifica se o payload começa como markup. Qualquer input textual/XML (que nunca
 * é uma imagem/vídeo/áudio/pdf binário legítimo) cai aqui e é rejeitado.
 */
function looksLikeSvgOrXml(buf: Buffer): boolean {
  let i = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3; // BOM
  while (
    i < buf.length &&
    (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)
  ) {
    i += 1;
  }
  const head = buf.toString('latin1', i, Math.min(buf.length, i + 1024)).toLowerCase();
  return (
    head.startsWith('<?xml') ||
    head.startsWith('<!doctype') ||
    head.startsWith('<svg') ||
    head.includes('<svg')
  );
}

/** Marca de brand ISO-BMFF (`ftyp`) → família (heic=imagem, m4a=áudio, resto=vídeo). */
function isobmffToken(brand: string): 'heic' | 'm4a' | 'iso-video' {
  const b = brand.trim().toLowerCase();
  if (['heic', 'heix', 'heif', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avci'].includes(b)) {
    return 'heic';
  }
  if (b.startsWith('m4a') || b.startsWith('m4b')) return 'm4a';
  return 'iso-video';
}

/**
 * Reconhece o container real por magic-bytes. Cobre os formatos que a plataforma
 * aceita (imagem/vídeo/áudio/pdf). Retorna `null` para bytes que não casam com
 * nenhum container binário conhecido (ex.: texto, HTML, SVG cru).
 */
function sniffContainer(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // PDF
  if (buf.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  // Imagens
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
  if (
    (buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) ||
    (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a)
  ) {
    return 'tiff';
  }
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'ico';
  // Família RIFF: sub-tag no offset 8 desambigua imagem/áudio/vídeo
  if (buf.toString('latin1', 0, 4) === 'RIFF') {
    const sub = buf.toString('latin1', 8, 12);
    if (sub === 'WEBP') return 'webp';
    if (sub === 'WAVE') return 'wav';
    if (sub === 'AVI ') return 'avi';
    return null;
  }
  // Áudio
  if (buf.toString('latin1', 0, 4) === 'OggS') return 'ogg';
  if (buf.toString('latin1', 0, 4) === 'fLaC') return 'flac';
  if (buf.toString('latin1', 0, 3) === 'ID3') return 'mp3';
  if (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0) return 'mp3'; // MPEG/AAC frame sync
  // ISO-BMFF (mp4/mov/m4a/heic): "ftyp" no offset 4
  if (buf.toString('latin1', 4, 8) === 'ftyp') return isobmffToken(buf.toString('latin1', 8, 12));
  // EBML (webm/mkv) — áudio ou vídeo
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'ebml';
  // MPEG program/transport stream
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01) return 'mpeg';
  return null;
}

/** Quais famílias declaradas cada container pode legitimamente satisfazer. */
const CONTAINER_CATEGORIES: Record<string, readonly MediaCategory[]> = {
  pdf: ['pdf'],
  png: ['image'],
  jpeg: ['image'],
  gif: ['image'],
  bmp: ['image'],
  tiff: ['image'],
  ico: ['image'],
  webp: ['image'],
  heic: ['image'],
  wav: ['audio'],
  flac: ['audio'],
  mp3: ['audio'],
  ogg: ['audio', 'video'],
  m4a: ['audio'],
  avi: ['video'],
  mpeg: ['video'],
  'iso-video': ['video'],
  ebml: ['audio', 'video'],
};

/**
 * Confirma que os bytes reais correspondem à família declarada. Falha se o payload
 * não é um container binário conhecido (texto/SVG/spoof) ou se o container detectado
 * não é compatível com o `Content-Type` declarado (ex.: PDF rotulado `image/png`).
 */
function magicBytesMatch(buf: Buffer, declared: MediaCategory): boolean {
  const container = sniffContainer(buf);
  if (container === null) return false;
  return CONTAINER_CATEGORIES[container]?.includes(declared) ?? false;
}

/** Intenções de normalização aceitas no campo `as`. */
const UPLOAD_INTENTS = ['voice', 'sticker', 'auto'] as const;
type UploadIntent = (typeof UPLOAD_INTENTS)[number];

function parseIntent(raw: unknown): UploadIntent {
  return typeof raw === 'string' && (UPLOAD_INTENTS as readonly string[]).includes(raw)
    ? (raw as UploadIntent)
    : 'auto';
}

function isAllowedType(contentType: string): boolean {
  return (
    ALLOWED_TYPE_PREFIXES.some((p) => contentType.startsWith(p)) ||
    ALLOWED_TYPES_EXACT.has(contentType)
  );
}

/** Troca a extensão do nome (ou anexa) para refletir o formato normalizado. */
function withExtension(name: string, ext: string): string {
  const base = name.replace(/\.[a-zA-Z0-9]+$/, '');
  return `${base}.${ext}`;
}

/**
 * Erro de cliente esperado (415/422) com `ref` correlacionável — espelha o contrato
 * do error handler central (`{ message, ref }` + header `X-Error-Ref`), mas preserva
 * a mensagem acionável (a genericização do handler só vale p/ 500 inesperado).
 */
function respondMediaError(res: Response, status: number, message: string): void {
  const ref = `hm_err_${randomUUID().slice(0, 8)}`;
  console.error(JSON.stringify({ level: 'warn', ref, status, message, scope: 'uploads' }));
  res.setHeader('X-Error-Ref', ref);
  res.status(status).json({ message, ref });
}

export function createUploadsRouter(): Router {
  const router = Router();
  const storage = createStorage();
  const guard = [requireAuth, withRLS, requireRole('conversation.assign')] as const;

  router.post(
    '/api/uploads',
    ...guard,
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    async (req: Request, res: Response) => {
      const contentType =
        (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ||
        'application/octet-stream';
      // SVG é sempre negado — mesmo quando o cliente rotula outro `image/*`, os bytes
      // são checados abaixo (defesa em profundidade contra XSS armazenado).
      if (contentType === SVG_MIME) {
        respondMediaError(res, 415, 'SVG não é permitido (vetor de XSS).');
        return;
      }
      if (!isAllowedType(contentType)) {
        res.status(415).json({ message: 'Tipo de arquivo não suportado.' });
        return;
      }

      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ message: 'Arquivo vazio ou inválido.' });
        return;
      }

      // Sniff dos bytes reais: bloqueia SVG/XML disfarçado e qualquer payload cujo
      // conteúdo não corresponda à família declarada (spoof de `Content-Type`).
      if (looksLikeSvgOrXml(body)) {
        respondMediaError(res, 415, 'SVG/XML não é permitido (vetor de XSS).');
        return;
      }
      const category = declaredCategory(contentType);
      if (category === null || !magicBytesMatch(body, category)) {
        respondMediaError(res, 415, 'O conteúdo do arquivo não corresponde ao tipo declarado.');
        return;
      }

      const intent = parseIntent(req.query['as']);
      const rawName = typeof req.query['filename'] === 'string' ? req.query['filename'] : 'arquivo';
      const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'arquivo';

      // Normalização por intenção. A modalidade exige um tipo-base coerente:
      // `voice` só faz sentido p/ áudio, `sticker` só p/ imagem (415 caso contrário).
      let outBody: Buffer = body;
      let outMime = contentType;
      let outName = safeName;
      try {
        if (intent === 'voice') {
          if (!contentType.startsWith('audio/')) {
            respondMediaError(res, 415, 'Nota de voz exige um arquivo de áudio.');
            return;
          }
          outBody = await transcodeToOpusOgg(body);
          outMime = 'audio/ogg';
          outName = withExtension(safeName, 'ogg');
        } else if (intent === 'sticker') {
          if (!contentType.startsWith('image/')) {
            respondMediaError(res, 415, 'Sticker exige um arquivo de imagem.');
            return;
          }
          outBody = await toStickerWebp(body);
          outMime = 'image/webp';
          outName = withExtension(safeName, 'webp');
        }
      } catch (err) {
        if (err instanceof MediaUnsupportedError) {
          respondMediaError(res, 415, err.message);
          return;
        }
        if (err instanceof MediaTranscodeError) {
          respondMediaError(res, 422, err.message);
          return;
        }
        throw err;
      }

      const workspaceId = req.auth!.workspace.id;
      const key = `workspaces/${workspaceId}/uploads/${randomUUID()}-${outName}`;

      await storage.put({ key, body: outBody, contentType: outMime });
      const signed = await storage.getSignedUrl(key, MEDIA_READ_TTL_SECONDS);
      res.json({ fileUrl: signed.url, key, mime: outMime });
    },
  );

  return router;
}
