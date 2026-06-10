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
import { Buffer } from 'node:buffer';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@hm/db';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

/** Fila de relay do socket (mesma constante de `apps/api/src/socket/relay.ts`). */
const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

/**
 * Evento de notificação de menção. NÃO existe ainda em `@hm/shared`
 * `SERVER_TO_CLIENT_EVENTS` — ver REPORT (peça faltante). Mantido como constante
 * local para tornar explícito o contrato pretendido sem editar arquivos fora do slot.
 */
const NOTE_MENTION_EVENT = 'note:mentioned' as const;

/** Limite de corpo da nota (anti-abuso; alinhado a mensagens internas). */
const MAX_NOTE_BODY = 5000;

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

// ── Publisher de relay (canal AMQP lazy, compartilhado por processo) ──────────
let handlePromise: Promise<MqHandle> | null = null;

async function getMqHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  try {
    return await handlePromise;
  } catch (err) {
    handlePromise = null;
    throw err;
  }
}

interface MentionRelayInput {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly noteId: string;
  readonly memberId: string;
  readonly authorMemberId: string | null;
  readonly preview: string;
}

/**
 * Publica um evento de menção para a room `member:{id}`. Best-effort: falha de
 * broker não derruba a criação da nota (a nota já está persistida) — apenas loga.
 */
async function emitMentionNotification(input: MentionRelayInput): Promise<void> {
  const { channel } = await getMqHandle();
  const envelope = makeEnvelope('socket.relay', input.workspaceId, {
    event: NOTE_MENTION_EVENT,
    target: { memberId: input.memberId },
    data: {
      conversationId: input.conversationId,
      noteId: input.noteId,
      mentionedMemberId: input.memberId,
      authorMemberId: input.authorMemberId,
      preview: input.preview,
    },
  });
  channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
  await Promise.resolve();
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
      const notes = await req.scoped!((tx) =>
        tx
          .select()
          .from(schema.conversationNotes)
          .where(eq(schema.conversationNotes.conversationId, conversationId))
          .orderBy(desc(schema.conversationNotes.createdAt))
          .limit(200),
      );
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
      const workspaceId = req.auth!.workspace.id;

      const created = await req.scoped!(async (tx) => {
        // A conversa precisa existir no tenant (RLS já garante o escopo).
        const [conversation] = await tx
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, conversationId))
          .limit(1);
        if (!conversation) return null;

        // Resolve mentions válidas: só membros existentes do workspace.
        let mentions: string[] = [];
        if (requested.length > 0) {
          const rows = await tx
            .select({ id: schema.members.id })
            .from(schema.members)
            .where(
              and(
                eq(schema.members.workspaceId, workspaceId),
                inArray(schema.members.id, requested),
              ),
            );
          mentions = rows.map((r) => r.id);
        }

        const [note] = await tx
          .insert(schema.conversationNotes)
          .values({ workspaceId, conversationId, authorMemberId, body, mentions })
          .returning();
        return note ?? null;
      });

      if (!created) {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }

      // Notifica cada mencionado (exceto o próprio autor) — best-effort.
      const preview = body.length > 140 ? `${body.slice(0, 137)}...` : body;
      const recipients = created.mentions.filter((id) => id !== authorMemberId);
      await Promise.allSettled(
        recipients.map((memberId) =>
          emitMentionNotification({
            workspaceId,
            conversationId,
            noteId: created.id,
            memberId,
            authorMemberId,
            preview,
          }),
        ),
      );

      res.status(201).json({ note: created });
    },
  );

  return router;
}
