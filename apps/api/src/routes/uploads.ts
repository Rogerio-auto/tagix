/**
 * Upload de mídia do LiveChat (outbound). Recebe o ARQUIVO cru, sobe no storage
 * (R2/local) e devolve a URL assinada de leitura — que vira a `mediaUrl` da
 * mensagem (o WhatsApp busca via `link` no envio; ver whatsapp/serializer.ts).
 *
 *   POST /api/uploads?filename=<nome>  body=<bytes>  → { fileUrl, key }
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

/** Teto de upload (cobre imagem/vídeo/áudio do WhatsApp com folga). */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** TTL da URL de leitura — 7 dias, igual à mídia inbound (a UI reidrata via REST). */
const MEDIA_READ_TTL_SECONDS = 7 * 24 * 60 * 60;

const ALLOWED_TYPE_PREFIXES = ['image/', 'video/', 'audio/'] as const;
const ALLOWED_TYPES_EXACT = new Set(['application/pdf']);

function isAllowedType(contentType: string): boolean {
  return (
    ALLOWED_TYPE_PREFIXES.some((p) => contentType.startsWith(p)) ||
    ALLOWED_TYPES_EXACT.has(contentType)
  );
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

      const rawName = typeof req.query['filename'] === 'string' ? req.query['filename'] : 'arquivo';
      const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'arquivo';
      const workspaceId = req.auth!.workspace.id;
      const key = `workspaces/${workspaceId}/uploads/${randomUUID()}-${safeName}`;

      await storage.put({ key, body, contentType });
      const signed = await storage.getSignedUrl(key, MEDIA_READ_TTL_SECONDS);
      res.json({ fileUrl: signed.url, key });
    },
  );

  return router;
}
