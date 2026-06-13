/**
 * Rotas de moderacao de comentarios Instagram (F15-S05, INSTAGRAM.md 7).
 *
 *   GET    /api/instagram/comments?mediaId=  — lista a thread de ig_comments (RLS)
 *   POST   /api/instagram/comments/:id/reply — responde publico ou por DM (enfileira)
 *   POST   /api/instagram/comments/:id/hide  — oculta/exibe um comment (enfileira)
 *   DELETE /api/instagram/comments/:id        — exclui um comment (enfileira)
 *
 * As acoes enfileiram OutboundJob IG (ig_public_reply/ig_private_reply/
 * ig_hide_comment) que o worker outbound (F15-S04) despacha via adapter. A
 * leitura le `ig_comments` sob RLS. Permission scope: responder = STAFF
 * (conversation.assign); ocultar/excluir = ADMINS (conversation.delete_message).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { enqueueCommentAction, type CommentActionResult } from '../../services/instagram/comment-actions';

function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

const listQuerySchema = z.object({ mediaId: z.string().trim().min(1).max(128) });

const replySchema = z.object({
  mode: z.enum(['public', 'private']),
  text: z.string().trim().min(1).max(2000),
});

const hideSchema = z.object({ hide: z.boolean().optional() });

export function createInstagramRouter(): Router {
  const router = Router();

  // GET /api/instagram/comments?mediaId= — thread de comments do post/reel (RLS).
  router.get(
    '/api/instagram/comments',
    requireAuth,
    withRLS,
    requireRole('conversation.view'),
    async (req: Request, res: Response) => {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ message: 'mediaId obrigatorio.' });
        return;
      }
      const { igComments } = schema;
      const rows = await req.scoped!((tx) =>
        tx
          .select({
            id: igComments.id,
            mediaId: igComments.mediaId,
            commentId: igComments.commentId,
            parentCommentId: igComments.parentCommentId,
            fromIgsid: igComments.fromIgsid,
            fromUsername: igComments.fromUsername,
            text: igComments.text,
            mediaKind: igComments.mediaKind,
            hidden: igComments.hidden,
            createdAt: igComments.createdAt,
          })
          .from(igComments)
          .where(eq(igComments.mediaId, parsed.data.mediaId))
          .orderBy(desc(igComments.createdAt)),
      );
      res.json({ comments: rows });
    },
  );

  // POST /api/instagram/comments/:id/reply — publico ou por DM (STAFF).
  router.post(
    '/api/instagram/comments/:id/reply',
    requireAuth,
    withRLS,
    requireRole('conversation.assign'),
    async (req: Request, res: Response) => {
      const commentId = param(req, 'id');
      if (!commentId) {
        res.status(400).json({ message: 'commentId ausente.' });
        return;
      }
      const parsed = replySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'mode (public|private) e text obrigatorios.' });
        return;
      }
      const out = await enqueueCommentAction(req, {
        kind: parsed.data.mode === 'public' ? 'ig_public_reply' : 'ig_private_reply',
        commentId,
        text: parsed.data.text,
      });
      respond(res, out);
    },
  );

  // POST /api/instagram/comments/:id/hide — oculta/exibe (ADMINS).
  router.post(
    '/api/instagram/comments/:id/hide',
    requireAuth,
    withRLS,
    requireRole('conversation.delete_message'),
    async (req: Request, res: Response) => {
      const commentId = param(req, 'id');
      if (!commentId) {
        res.status(400).json({ message: 'commentId ausente.' });
        return;
      }
      const parsed = hideSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ message: 'Payload invalido.' });
        return;
      }
      const out = await enqueueCommentAction(req, {
        kind: 'ig_hide_comment',
        commentId,
        hide: parsed.data.hide ?? true,
      });
      respond(res, out);
    },
  );

  // DELETE /api/instagram/comments/:id — exclui (ADMINS). Destrutivo.
  router.delete(
    '/api/instagram/comments/:id',
    requireAuth,
    withRLS,
    requireRole('conversation.delete_message'),
    async (req: Request, res: Response) => {
      const commentId = param(req, 'id');
      if (!commentId) {
        res.status(400).json({ message: 'commentId ausente.' });
        return;
      }
      // Exclusao usa o hide pipeline do adapter? Nao: delete e acao propria.
      const out = await enqueueCommentAction(req, { kind: 'ig_delete_comment', commentId });
      respond(res, out);
    },
  );

  return router;
}

function respond(res: Response, out: CommentActionResult): void {
  if (out.ok) {
    res.status(202).json({ enqueued: true, messageId: out.messageId });
    return;
  }
  res.status(out.status).json({ message: out.message });
}
