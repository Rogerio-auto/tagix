/**
 * Estado operacional da conversa (F30-S02 / LIVECHAT_OPS.md §2/§5) — completa a
 * camada de operação que faltava sobre o LiveChat núcleo: mudar o status
 * (resolver / snooze / reabrir / pending) e alternar o `ai_mode` (on/off/paused)
 * com handoff consciente.
 *
 * Endpoints:
 *  - POST /api/conversations/:id/status   — body `{ status, snoozedUntil? }`.
 *    Permissão `conversation.snooze` (quando `snoozed`) ou `conversation.resolve`
 *    (demais). AGENT só nas conversas atribuídas a ele. Emite
 *    `conversation:state_changed`.
 *  - POST /api/conversations/:id/ai-mode  — body `{ aiMode, reason? }`. Permissão
 *    `conversation.ai_mode`. AGENT só nas suas. Ao pausar manualmente grava
 *    `ai_paused_reason='manual'` + `ai_paused_at` + `ai_paused_by`; ao ligar/
 *    desligar limpa esses campos (e o reengajamento agendado). Emite
 *    `conversation:ai_mode_changed`.
 *
 * Atribuição/transferência ficam em `routing.ts` (não tocado). A auto-pausa no
 * envio humano (`human_takeover`) é da S04 (em `messages.ts`) — aqui só ações
 * manuais. Relay best-effort via fila `hm.q.socket.relay`, no mesmo padrão de
 * `routing.ts`: a persistência já está commitada quando o evento é publicado.
 *
 * Router NÃO montado aqui — `app.ts` monta `createConversationStateRouter()`.
 */
import { Buffer } from 'node:buffer';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { assertConversationVisible, schema } from '@hm/db';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import {
  AiModeSchema,
  AiPausedReasonSchema,
  can,
  type AiMode,
  type AiPausedReason,
  type ConversationAiModeChangedPayload,
  type ConversationStateChangedPayload,
  type Permission,
  type Role,
} from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

/** Fila de relay do socket (mesma constante de `apps/api/src/socket/relay.ts`). */
const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

/** Narrowing do `req.params['id']` (Express 5 tipa como `string | string[]`). */
function paramId(req: Request, name: string): string {
  const raw = req.params[name];
  return typeof raw === 'string' ? raw : '';
}

// ── Schemas de input ──────────────────────────────────────────────────────────

/** Status operacionais que esta API permite setar manualmente (`conversations_status_chk`). */
const STATUS_ACTIONS = ['open', 'pending', 'resolved', 'snoozed'] as const;

const statusSchema = z
  .object({
    status: z.enum(STATUS_ACTIONS),
    /** Obrigatório (e futuro) só quando `status='snoozed'`. */
    snoozedUntil: z.coerce.date().optional(),
  })
  .refine((v) => v.status !== 'snoozed' || (v.snoozedUntil !== undefined && v.snoozedUntil.getTime() > Date.now()), {
    message: 'snoozedUntil deve ser uma data futura para snooze.',
    path: ['snoozedUntil'],
  });

const aiModeSchema = z.object({
  aiMode: AiModeSchema,
  /** Motivo opcional; pausa manual via API sempre registra `manual`. */
  reason: AiPausedReasonSchema.optional(),
});

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

interface RelayInput<E extends string, P> {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly event: E;
  readonly data: P;
}

/**
 * Publica um evento de socket para as rooms da conversa e do workspace.
 * Best-effort: falha de broker não derruba a operação (já persistida).
 */
async function emitRelay<E extends string, P>(input: RelayInput<E, P>): Promise<void> {
  const { channel } = await getMqHandle();
  const envelope = makeEnvelope('socket.relay', input.workspaceId, {
    event: input.event,
    target: { conversationId: input.conversationId, workspace: true },
    data: input.data,
  });
  channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
  await Promise.resolve();
}

/**
 * Escopo AGENT-só-nas-suas: OWNER/ADMIN/SUPERVISOR atuam em qualquer conversa do
 * workspace (RLS já escopa o tenant); AGENT só nas atribuídas a ele. READONLY já
 * é barrado pela matriz `can()` (não detém estas permissões).
 */
function agentScopeOk(role: string, assignedTo: string | null, memberId: string): boolean {
  if (role !== 'AGENT') return true;
  return assignedTo !== null && assignedTo === memberId;
}

export function createConversationStateRouter(): Router {
  const router = Router();

  // POST /api/conversations/:id/status — resolver / snooze / reabrir / pending.
  // O guard de role é dinâmico (snooze vs resolve), então só exigimos sessão+RLS
  // no middleware e checamos a permissão exata após validar o body.
  router.post(
    '/api/conversations/:id/status',
    requireAuth,
    withRLS,
    async (req: Request, res: Response): Promise<void> => {
      const conversationId = paramId(req, 'id');
      if (!conversationId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Status inválido.', issues: parsed.error.issues });
        return;
      }
      const { status, snoozedUntil } = parsed.data;
      // member.role vem do DB (text) — narrowamos para Role (mesmo padrão de auth.ts).
      const role = req.auth!.member.role as Role;
      const memberId = req.auth!.member.id;
      const workspaceId = req.auth!.workspace.id;

      const perm: Permission = status === 'snoozed' ? 'conversation.snooze' : 'conversation.resolve';
      if (!can(role, perm)) {
        res.status(403).json({ message: 'Sem permissão para esta ação.' });
        return;
      }

      const result = await req.scoped!(async (tx) => {
        // Guard de visibilidade por-conversa (S07.1): fecha SUPERVISOR agindo fora
        // dos depts que lidera. 404 (não confirma) precede o 403 de escopo do AGENT.
        if (!(await assertConversationVisible(tx, { memberId, role, workspaceId }, conversationId))) {
          return { notFound: true } as const;
        }
        const [conversation] = await tx
          .select({ assignedTo: schema.conversations.assignedTo })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, conversationId))
          .limit(1);
        if (!conversation) return { notFound: true } as const;
        if (!agentScopeOk(role, conversation.assignedTo, memberId)) {
          return { forbidden: true } as const;
        }

        await tx
          .update(schema.conversations)
          .set({
            status,
            // snooze grava a data; qualquer outra transição limpa o snooze pendente.
            snoozedUntil: status === 'snoozed' ? snoozedUntil! : null,
            updatedAt: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));
        return { ok: true } as const;
      });

      if ('notFound' in result) {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }
      if ('forbidden' in result) {
        res.status(403).json({ message: 'Conversa não atribuída a você.' });
        return;
      }

      const payload: ConversationStateChangedPayload = { conversationId, status };
      await Promise.allSettled([
        emitRelay({
          workspaceId,
          conversationId,
          event: 'conversation:state_changed' as const,
          data: payload,
        }),
      ]);

      res.json({ conversationId, status, snoozedUntil: status === 'snoozed' ? snoozedUntil : null });
    },
  );

  // POST /api/conversations/:id/ai-mode — liga/desliga/pausa a IA (handoff).
  router.post(
    '/api/conversations/:id/ai-mode',
    requireAuth,
    withRLS,
    requireRole('conversation.ai_mode'),
    async (req: Request, res: Response): Promise<void> => {
      const conversationId = paramId(req, 'id');
      if (!conversationId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const parsed = aiModeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'ai_mode inválido.', issues: parsed.error.issues });
        return;
      }
      const aiMode: AiMode = parsed.data.aiMode;
      const role = req.auth!.member.role;
      const memberId = req.auth!.member.id;
      const workspaceId = req.auth!.workspace.id;

      // Pausa manual via API: reason sempre 'manual' (human_takeover é da S04).
      const pausedReason: AiPausedReason | null = aiMode === 'paused' ? 'manual' : null;
      const now = new Date();

      const result = await req.scoped!(async (tx) => {
        // Guard de visibilidade por-conversa (S07.1): fecha SUPERVISOR agindo fora
        // dos depts que lidera. 404 (não confirma) precede o 403 de escopo do AGENT.
        if (!(await assertConversationVisible(tx, { memberId, role: role as Role, workspaceId }, conversationId))) {
          return { notFound: true } as const;
        }
        const [conversation] = await tx
          .select({ assignedTo: schema.conversations.assignedTo })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, conversationId))
          .limit(1);
        if (!conversation) return { notFound: true } as const;
        if (!agentScopeOk(role, conversation.assignedTo, memberId)) {
          return { forbidden: true } as const;
        }

        await tx
          .update(schema.conversations)
          .set({
            aiMode,
            // Pausa manual grava reason/at/by; ligar ou desligar limpa o estado de
            // pausa e o reengajamento agendado (não há retomada pendente).
            aiPausedReason: pausedReason,
            aiPausedAt: aiMode === 'paused' ? now : null,
            aiPausedBy: aiMode === 'paused' ? memberId : null,
            aiResumeAt: null,
            updatedAt: now,
          })
          .where(eq(schema.conversations.id, conversationId));
        return { ok: true } as const;
      });

      if ('notFound' in result) {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }
      if ('forbidden' in result) {
        res.status(403).json({ message: 'Conversa não atribuída a você.' });
        return;
      }

      const payload: ConversationAiModeChangedPayload = {
        conversationId,
        aiMode,
        reason: pausedReason,
      };
      await Promise.allSettled([
        emitRelay({
          workspaceId,
          conversationId,
          event: 'conversation:ai_mode_changed' as const,
          data: payload,
        }),
      ]);

      res.json({ conversationId, aiMode, reason: pausedReason });
    },
  );

  return router;
}
