/**
 * Roteamento de conversas (F1-S23 / LIVECHAT.md) — atribuição e transferência
 * manual entre members/departments, com histórico auditável (`routing_history`).
 *
 * Endpoints:
 *  - POST /api/conversations/:id/assign   — atribui a conversa a um member
 *    (assign-to-me ou a outro member). Permissão `conversation.assign` (STAFF).
 *  - POST /api/conversations/:id/transfer — transfere a conversa para outro
 *    member e/ou outro department, com `reason` opcional. Permissão
 *    `conversation.transfer` (STAFF).
 *
 * Ambos escrevem uma linha imutável em `routing_history` (RLS-escopada) na mesma
 * transação em que atualizam a conversa, e emitem eventos de socket via relay
 * (`hm.q.socket.relay`): `conversation:assigned` (mudança de owner) e/ou
 * `conversation:routing_changed` (mudança de department). Best-effort no relay:
 * a persistência já está commitada quando o evento é publicado.
 *
 * Router NÃO montado aqui — o orchestrator monta `createRoutingRouter()` em
 * `app.ts` (ver REPORT do slot).
 */
import { Buffer } from 'node:buffer';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { assertConversationVisible, schema } from '@hm/db';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import type {
  ConversationAssignedPayload,
  ConversationRoutingChangedPayload,
  Role,
} from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

/** Fila de relay do socket (mesma constante de `apps/api/src/socket/relay.ts`). */
const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

/** Narrowing do `req.params['id']` (Express 5 tipa como `string | string[]`). */
function paramId(req: Request, name: string): string {
  const raw = req.params[name];
  return typeof raw === 'string' ? raw : '';
}

const assignSchema = z.object({
  /** Member que passa a deter a conversa. Para assign-to-me o client envia o próprio id. */
  memberId: z.string().uuid(),
});

const transferSchema = z
  .object({
    /** Novo owner (opcional — pode-se transferir só de department). */
    memberId: z.string().uuid().nullable().optional(),
    /** Novo department (opcional — pode-se transferir só de member). */
    departmentId: z.string().uuid().nullable().optional(),
    /** Justificativa opcional da transferência (auditável). */
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((v) => v.memberId !== undefined || v.departmentId !== undefined, {
    message: 'Informe memberId e/ou departmentId.',
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
 * Best-effort: falha de broker não derruba a operação (já persistida) — propaga
 * para o caller decidir (que faz `allSettled`).
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

/** Snapshot de roteamento de uma conversa antes/depois da mudança. */
interface RoutingSnapshot {
  readonly assignedTo: string | null;
  readonly departmentId: string | null;
}

export function createRoutingRouter(): Router {
  const router = Router();
  const assignGuard = [requireAuth, withRLS, requireRole('conversation.assign')] as const;
  const transferGuard = [requireAuth, withRLS, requireRole('conversation.transfer')] as const;

  // GET /api/conversations/:id/routing/history — trilha de roteamento (RLS-escopada).
  router.get(
    '/api/conversations/:id/routing/history',
    requireAuth,
    withRLS,
    requireRole('conversation.view'),
    async (req: Request, res: Response): Promise<void> => {
      const conversationId = paramId(req, 'id');
      if (!conversationId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const memberId = req.auth!.member.id;
      const role = req.auth!.member.role as Role;
      const workspaceId = req.auth!.workspace.id;
      // Guard de visibilidade por-conversa (S07.1): histórico só para quem enxerga a conversa.
      const history = await req.scoped!(async (tx) => {
        if (!(await assertConversationVisible(tx, { memberId, role, workspaceId }, conversationId))) {
          return null;
        }
        return tx
          .select()
          .from(schema.routingHistory)
          .where(eq(schema.routingHistory.conversationId, conversationId))
          .orderBy(desc(schema.routingHistory.createdAt))
          .limit(200);
      });
      if (history === null) {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }
      res.json({ history });
    },
  );

  // POST /api/conversations/:id/assign — atribui a conversa a um member.
  router.post(
    '/api/conversations/:id/assign',
    ...assignGuard,
    async (req: Request, res: Response): Promise<void> => {
      const conversationId = paramId(req, 'id');
      if (!conversationId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const parsed = assignSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Atribuição inválida.' });
        return;
      }
      const { memberId } = parsed.data;
      const workspaceId = req.auth!.workspace.id;
      const actorMemberId = req.auth!.member.id;
      const actorRole = req.auth!.member.role as Role;

      const result = await req.scoped!(async (tx) => {
        // Guard de visibilidade por-conversa (S07.1): só roteia conversa visível
        // ao ator (fecha SUPERVISOR agindo fora dos depts que lidera). 404 = não confirma.
        if (
          !(await assertConversationVisible(
            tx,
            { memberId: actorMemberId, role: actorRole, workspaceId },
            conversationId,
          ))
        ) {
          return null;
        }
        const [conversation] = await tx
          .select({
            assignedTo: schema.conversations.assignedTo,
            departmentId: schema.conversations.departmentId,
          })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, conversationId))
          .limit(1);
        if (!conversation) return null;

        // Member destino precisa pertencer ao workspace (RLS já escopa a query).
        const [target] = await tx
          .select({ id: schema.members.id })
          .from(schema.members)
          .where(eq(schema.members.id, memberId))
          .limit(1);
        if (!target) return { notFoundMember: true } as const;

        const before: RoutingSnapshot = {
          assignedTo: conversation.assignedTo,
          departmentId: conversation.departmentId,
        };

        await tx
          .update(schema.conversations)
          .set({ assignedTo: memberId, updatedAt: new Date() })
          .where(eq(schema.conversations.id, conversationId));

        await tx.insert(schema.routingHistory).values({
          workspaceId,
          conversationId,
          action: 'assign',
          fromMemberId: before.assignedTo,
          toMemberId: memberId,
          fromDepartment: before.departmentId,
          toDepartment: before.departmentId,
          actorMemberId,
        });

        return { before, after: { assignedTo: memberId, departmentId: before.departmentId } };
      });

      if (!result) {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }
      if ('notFoundMember' in result) {
        res.status(404).json({ message: 'Membro não encontrado.' });
        return;
      }

      // Evento de mudança de owner (best-effort).
      const assignedPayload: ConversationAssignedPayload = {
        conversationId,
        assignedTo: result.after.assignedTo,
      };
      await Promise.allSettled([
        emitRelay({
          workspaceId,
          conversationId,
          event: 'conversation:assigned' as const,
          data: assignedPayload,
        }),
      ]);

      res.json({ conversationId, assignedTo: result.after.assignedTo });
    },
  );

  // POST /api/conversations/:id/transfer — transfere member e/ou department.
  router.post(
    '/api/conversations/:id/transfer',
    ...transferGuard,
    async (req: Request, res: Response): Promise<void> => {
      const conversationId = paramId(req, 'id');
      if (!conversationId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const parsed = transferSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Transferência inválida.' });
        return;
      }
      const { memberId, departmentId, reason } = parsed.data;
      const workspaceId = req.auth!.workspace.id;
      const actorMemberId = req.auth!.member.id;
      const actorRole = req.auth!.member.role as Role;

      const result = await req.scoped!(async (tx) => {
        // Guard de visibilidade por-conversa (S07.1): só transfere conversa visível
        // ao ator (fecha SUPERVISOR agindo fora dos depts que lidera). 404 = não confirma.
        if (
          !(await assertConversationVisible(
            tx,
            { memberId: actorMemberId, role: actorRole, workspaceId },
            conversationId,
          ))
        ) {
          return null;
        }
        const [conversation] = await tx
          .select({
            assignedTo: schema.conversations.assignedTo,
            departmentId: schema.conversations.departmentId,
          })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, conversationId))
          .limit(1);
        if (!conversation) return null;

        // Valida o member destino (quando informado e não-null) no workspace.
        if (memberId) {
          const [target] = await tx
            .select({ id: schema.members.id })
            .from(schema.members)
            .where(eq(schema.members.id, memberId))
            .limit(1);
          if (!target) return { notFoundMember: true } as const;
        }

        const before: RoutingSnapshot = {
          assignedTo: conversation.assignedTo,
          departmentId: conversation.departmentId,
        };
        // `undefined` no payload = não mexe nesse campo; `null` = limpa.
        const after: RoutingSnapshot = {
          assignedTo: memberId === undefined ? before.assignedTo : memberId,
          departmentId: departmentId === undefined ? before.departmentId : departmentId,
        };

        await tx
          .update(schema.conversations)
          .set({
            assignedTo: after.assignedTo,
            departmentId: after.departmentId,
            updatedAt: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        const departmentChanged = after.departmentId !== before.departmentId;
        const action = departmentChanged ? 'transfer_department' : 'transfer_member';

        await tx.insert(schema.routingHistory).values({
          workspaceId,
          conversationId,
          action,
          fromMemberId: before.assignedTo,
          toMemberId: after.assignedTo,
          fromDepartment: before.departmentId,
          toDepartment: after.departmentId,
          reason: reason ?? null,
          actorMemberId,
        });

        return { before, after };
      });

      if (!result) {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }
      if ('notFoundMember' in result) {
        res.status(404).json({ message: 'Membro não encontrado.' });
        return;
      }

      const { before, after } = result;
      const tasks: Array<Promise<void>> = [];
      if (after.assignedTo !== before.assignedTo) {
        const assignedPayload: ConversationAssignedPayload = {
          conversationId,
          assignedTo: after.assignedTo,
        };
        tasks.push(
          emitRelay({
            workspaceId,
            conversationId,
            event: 'conversation:assigned' as const,
            data: assignedPayload,
          }),
        );
      }
      if (after.departmentId !== before.departmentId) {
        const routingPayload: ConversationRoutingChangedPayload = {
          conversationId,
          routing: { from: before.departmentId, to: after.departmentId },
        };
        tasks.push(
          emitRelay({
            workspaceId,
            conversationId,
            event: 'conversation:routing_changed' as const,
            data: routingPayload,
          }),
        );
      }
      await Promise.allSettled(tasks);

      res.json({
        conversationId,
        assignedTo: after.assignedTo,
        departmentId: after.departmentId,
      });
    },
  );

  return router;
}
