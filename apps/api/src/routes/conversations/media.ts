/**
 * Refresh de signed URL de mídia (F52-S06 / LIVECHAT.md).
 *
 * `GET /api/conversations/:id/messages/:messageId/refresh-media-url`
 *
 * A `media_url` persistida na mensagem é uma signed URL com TTL (7 dias). Quando
 * o usuário reabre uma conversa antiga, essa URL pode ter expirado e a mídia não
 * renderiza. Este endpoint regenera a signed URL a partir da KEY ESTÁVEL do
 * objeto (`messages.metadata.mediaKey`, gravada pelo worker de mídia) — sem
 * re-upload, só re-presign via `@hm/storage` (LocalDriver dev / R2Driver prod).
 *
 * Segurança:
 *  - Guard de visibilidade por-conversa (S07.1): reusa `assertConversationVisible`
 *    — membro sem visibilidade recebe 404 (não confirma existência → IDOR-safe).
 *  - A mensagem é buscada por (id AND conversationId): impede pedir a key de uma
 *    mensagem de outra conversa via id arbitrário.
 *  - Mensagem sem `mediaKey` armazenada → 404 (nada a reidratar).
 *
 * Router NÃO montado em app.ts — é agregado por `createConversationsRouter()`
 * (`./index`), que já é montado uma única vez na app.
 */
import { Router, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { assertConversationVisible, schema } from '@hm/db';
import { createStorage } from '@hm/storage';
import type { Role } from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

/**
 * TTL da nova signed URL — 7 dias, igual à mídia inbound/outbound
 * (`apps/workers/src/media/adapters.ts` e `routes/uploads.ts`). Mantém o mesmo
 * contrato: a UI reidrata via este endpoint se expirar de novo.
 */
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Chave em `messages.metadata` onde o worker grava a key estável do objeto. */
const MEDIA_KEY_META = 'mediaKey' as const;

/** Narrowing do `req.params[name]` (Express 5 tipa como `string | string[]`). */
function paramId(req: Request, name: string): string {
  const raw = req.params[name];
  return typeof raw === 'string' ? raw : '';
}

type LookupResult =
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'no_media' }
  | { readonly kind: 'ok'; readonly mediaKey: string };

export function createMediaRouter(): Router {
  const router = Router();
  const storage = createStorage();
  // Reidratar mídia é leitura — mesmo gate dos demais GET por-conversa.
  const guard = [requireAuth, withRLS, requireRole('conversation.view')] as const;

  router.get(
    '/api/conversations/:id/messages/:messageId/refresh-media-url',
    ...guard,
    async (req: Request, res: Response): Promise<void> => {
      const conversationId = paramId(req, 'id');
      const messageId = paramId(req, 'messageId');
      if (!conversationId || !messageId) {
        res.status(400).json({ message: 'id ou messageId ausente.' });
        return;
      }

      const memberId = req.auth!.member.id;
      const role = req.auth!.member.role as Role;
      const workspaceId = req.auth!.workspace.id;

      const lookup = await req.scoped!(async (tx): Promise<LookupResult> => {
        // Guard de visibilidade por-conversa (S07.1). 404 = não confirma existência.
        if (
          !(await assertConversationVisible(tx, { memberId, role, workspaceId }, conversationId))
        ) {
          return { kind: 'forbidden' };
        }
        // Mensagem escopada à conversa: impede ler a key de outra conversa do tenant.
        const [row] = await tx
          .select({ metadata: schema.messages.metadata })
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.id, messageId),
              eq(schema.messages.conversationId, conversationId),
            ),
          )
          .limit(1);
        if (!row) return { kind: 'no_media' };
        const key = row.metadata[MEDIA_KEY_META];
        if (typeof key !== 'string' || key.length === 0) return { kind: 'no_media' };
        return { kind: 'ok', mediaKey: key };
      });

      if (lookup.kind === 'forbidden') {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }
      if (lookup.kind === 'no_media') {
        res.status(404).json({ message: 'Mídia não encontrada para esta mensagem.' });
        return;
      }

      // Re-presign (sem re-upload). LocalDriver (dev) / R2Driver (prod).
      const signed = await storage.getSignedUrl(lookup.mediaKey, REFRESH_TTL_SECONDS);
      res.json({ mediaUrl: signed.url, expiresAt: signed.expiresAt });
    },
  );

  return router;
}
