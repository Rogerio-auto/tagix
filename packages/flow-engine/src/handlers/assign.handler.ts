/**
 * Handler `assign` (F31-S10). Atribui a conversa a um membro do workspace — por
 * alvo fixo (`specific` + `memberId`) ou por estrategia automatica
 * (`round_robin`/`least_busy`) resolvida sobre o time ja vinculado a conversa.
 *
 * DESIGN: espelha o auto-assign do inbound (F30-S09, apps/workers): a escolha do
 * membro mora em `pickAutoAssignee` (@hm/db) — o SQL de rodizio/carga fica
 * centralizado no repo, sem duplicacao. A flow-engine NAO importa apps/api
 * (camada): a mutacao roda direto sob RLS via `withWorkspace` (mesmo estilo de
 * register_conversion/move_stage). Um assign disparado por um flow PUBLICADO age
 * como SISTEMA — a RLS garante o escopo do tenant; nao ha guards manuais.
 *
 * Trilha auditavel: toda atribuicao efetiva grava uma linha em `routing_history`
 * (action='assign', `actor_member_id` null = automacao). Sem conversa na
 * execucao: no-op + log (igual aos demais handlers system-authoritative).
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { pickAutoAssignee, schema, withWorkspace } from '@hm/db';
import type { FlowHandler } from '../types';

const STRATEGIES = ['specific', 'round_robin', 'least_busy'] as const;

const assignSchema = z.object({
  /** `specific` usa `memberId`; round_robin/least_busy resolvem sobre o time da conversa. */
  strategy: z.enum(STRATEGIES).optional(),
  /** Membro alvo quando strategy='specific' (members.id). */
  memberId: z.string().uuid().optional(),
});

type AssignData = z.infer<typeof assignSchema>;

const { conversations, routingHistory } = schema;

export const assignHandler: FlowHandler<AssignData> = {
  schema: assignSchema,
  async execute(node, ctx) {
    const data = assignSchema.parse(node.data);
    const strategy = data.strategy ?? 'specific';

    if (!ctx.conversationId) {
      ctx.log('warn', 'assign: execucao sem conversationId; no-op', { nodeType: 'assign' });
      return { status: 'SUCCESS' };
    }
    const conversationId = ctx.conversationId;

    const outcome = await withWorkspace(ctx.workspaceId, async (tx) => {
      const [conv] = await tx
        .select({ assignedTo: conversations.assignedTo, teamId: conversations.teamId })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);
      if (!conv) return { kind: 'conversation_not_found' as const };

      // Resolve o membro alvo conforme a estrategia.
      let assignee: string | null;
      if (strategy === 'specific') {
        assignee = data.memberId ?? null;
      } else if (conv.teamId === null) {
        return { kind: 'no_team' as const };
      } else {
        // pickAutoAssignee usa o pool owner (read-only) filtrando por team_id —
        // espelha DbInboundAutoAssign do worker (F30-S09).
        assignee = await pickAutoAssignee({ teamId: conv.teamId, strategy });
      }
      if (assignee === null) return { kind: 'no_assignee' as const };
      if (conv.assignedTo === assignee) return { kind: 'noop' as const, assignee };

      await tx
        .update(conversations)
        .set({ assignedTo: assignee, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
      await tx.insert(routingHistory).values({
        workspaceId: ctx.workspaceId,
        conversationId,
        action: 'assign',
        fromMemberId: conv.assignedTo,
        toMemberId: assignee,
        reason: 'flow',
      });
      return { kind: 'assigned' as const, fromMemberId: conv.assignedTo, assignee };
    });

    switch (outcome.kind) {
      case 'conversation_not_found':
        ctx.log('error', 'assign: conversa inexistente', { conversationId });
        break;
      case 'no_team':
        ctx.log('warn', 'assign: estrategia automatica sem time na conversa; no-op', { strategy });
        break;
      case 'no_assignee':
        ctx.log('warn', 'assign: nenhum membro elegivel para atribuicao', { strategy });
        break;
      case 'noop':
        ctx.log('info', 'assign: conversa ja atribuida ao membro alvo', {
          assignee: outcome.assignee,
        });
        break;
      case 'assigned':
        ctx.log('info', 'assign: conversa atribuida', {
          assignee: outcome.assignee,
          fromMemberId: outcome.fromMemberId,
        });
        break;
    }
    return { status: 'SUCCESS' };
  },
};
