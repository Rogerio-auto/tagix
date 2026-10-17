/**
 * Notas internas por conversa (F1-S22 / LIVECHAT.md §7.4).
 *
 * Notas são visíveis só para a equipe (nunca enviadas ao contato). O corpo pode
 * mencionar membros via `@member`; os ids mencionados são validados contra os
 * membros do workspace (RLS-escopado) e materializados em `conversation_notes.mentions`.
 *
 * Cada membro mencionado recebe uma notificação por socket na room `member:{id}`
 * (via `hm.q.socket.relay` → `apps/api/src/socket/relay.ts`). A persistência de
 * notificação ("inbox") depende de uma tabela `notifications` que ainda não existe
 * no schema — ver REPORT do slot (peça de infra faltante). Aqui só emitimos o
 * evento de socket; nada é inventado fora dos arquivos permitidos.
 *
 * Router NÃO montado aqui — o orchestrator monta `createNotesRouter()` em
 * `conversations/index.ts`.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { assertConversationVisible, schema } from '@hm/db';
import type { Role } from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import {
  MAX_NOTE_BODY,
  createNote,
  notifyNoteMentions,
} from '../../services/conversation-notes/create';

const createNoteSchema = z.object({
  body: z.string().trim().min(1).max(MAX_NOTE_BODY),
  /** Ids de membros mencionados no corpo (`@member`), resolvidos pelo client. */
  mentions: z.array(z.string().uuid()).max(50).optional(),
});

/** Narrowing do `req.params['id']` (Express 5 tipa como `string | string[]`). */
function paramId(req: Request, name: string): string {
  const raw = req.params[name];
  return typeof raw === 'string' ? raw : '';
}

export function createNotesRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('conversation.view')] as const;
  // Escrever nota é ação de staff (READONLY não cria). Sem permissão dedicada no
  // matriz atual → reusa `conversation.assign` (STAFF). Ver REPORT.
  const writeGuard = [requireAuth, withRLS, requireRole('conversation.assign')] as const;

  // GET /api/conversations/:id/notes — notas da conversa (RLS-escopada), mais recentes primeiro.
  router.get(
    '/api/conversations/:id/notes',
    ...viewGuard,
    async (req: Request, res: Response) => {
      const conversationId = paramId(req, 'id');
      if (!conversationId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const memberId = req.auth!.member.id;
      const role = req.auth!.member.role as Role;
      const workspaceId = req.auth!.workspace.id;
      // Guard de visibilidade por-conversa (S07.1): notas internas só para quem
      // enxerga a conversa. 404 = não confirma existência.
      const notes = await req.scoped!(async (tx) => {
        if (!(await assertConversationVisible(tx, { memberId, role, workspaceId }, conversationId))) {
          return null;
        }
        return tx
          .select()
          .from(schema.conversationNotes)
          .where(eq(schema.conversationNotes.conversationId, conversationId))
          .orderBy(desc(schema.conversationNotes.createdAt))
          .limit(200);
      });
      if (notes === null) {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }
      res.json({ notes });
    },
  );

  // POST /api/conversations/:id/notes — cria nota + valida mentions + notifica mencionados.
  router.post(
    '/api/conversations/:id/notes',
    ...writeGuard,
    async (req: Request, res: Response) => {
      const conversationId = paramId(req, 'id');
      if (!conversationId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const parsed = createNoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Nota inválida.' });
        return;
      }
      const { body } = parsed.data;
      const requested = [...new Set(parsed.data.mentions ?? [])];
      const authorMemberId = req.auth!.member.id;
      const role = req.auth!.member.role as Role;
      const workspaceId = req.auth!.workspace.id;

      // Mesmo service do Copiloto (`conversation.note`, F73-S08).
      const created = await req.scoped!((tx) =>
        createNote(tx, {
          workspaceId,
          conversationId,
          author: { memberId: authorMemberId, role },
          body,
          mentions: requested,
        }),
      );

      if (!created) {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }

      // Notifica cada mencionado (exceto o próprio autor) — best-effort, depois do commit.
      await notifyNoteMentions(workspaceId, created);

      res.status(201).json({ note: created });
    },
  );

  return router;
}
