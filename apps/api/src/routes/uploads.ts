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
        (req.headers['content-type'] ?? '').split(';')[0]?.trim() || 'application/octet-stream';
      if (!isAllowedType(contentType)) {
        res.status(415).json({ message: 'Tipo de arquivo não suportado.' });
        return;
      }

      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ message: 'Arquivo vazio ou inválido.' });
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
