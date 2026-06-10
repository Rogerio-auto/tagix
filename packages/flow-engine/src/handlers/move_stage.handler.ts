/**
 * Handler `move_stage` (FLOW_BUILDER.md §4). F5-S16: move o deal do contato para
 * `data.stageId` e registra deal_history (actor `flow`).
 *
 * DESIGN: a movimentacao "canonica" (com validacao de transition_rules + seam de
 * automacao/socket) e o servico `moveDealToStage` de apps/api (F5-S05). A
 * flow-engine NAO pode importar apps/api (camada). Moves disparados por um FLOW
 * publicado sao SYSTEM-AUTHORITATIVE: assim como as automacoes de stage, eles
 * NAO passam pelos guards manuais de transition_rules (que sao UX de move manual).
 * Aqui aplicamos a transicao + deal_history diretamente sob RLS — sem duplicar a
 * logica de regras (deliberadamente nao avaliamos transition_rules para flow).
 *
 * O deal e resolvido pelo contato da execucao: o deal aberto mais recente do
 * contato (opcionalmente filtrado por `data.pipelineId`). Sem contato/deal: no-op.
 */
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import type { FlowHandler } from '../types';

const moveStageSchema = z.object({
  stageId: z.string().uuid(),
  pipelineId: z.string().uuid().optional(),
});

const { deals, stages, dealHistory } = schema;

export const moveStageHandler: FlowHandler<z.infer<typeof moveStageSchema>> = {
  schema: moveStageSchema,
  async execute(node, ctx) {
    const data = moveStageSchema.parse(node.data);
    if (!ctx.contactId) {
      ctx.log('warn', 'move_stage: execucao sem contactId; no-op', { nodeType: 'move_stage' });
      return { status: 'SUCCESS' };
    }
    const moved = await withWorkspace(ctx.workspaceId, async (tx) => {
      // Valida que o stage destino existe (e captura o pipeline dele).
      const [target] = await tx.select().from(stages).where(eq(stages.id, data.stageId)).limit(1);
      if (!target) return { kind: 'stage_not_found' as const };

      // Resolve o deal aberto mais recente do contato no pipeline do stage destino.
      const dealFilters = [
        eq(deals.contactId, ctx.contactId!),
        eq(deals.pipelineId, data.pipelineId ?? target.pipelineId),
        isNull(deals.closedAt),
      ];
      const [deal] = await tx
        .select()
        .from(deals)
        .where(and(...dealFilters))
        .orderBy(desc(deals.createdAt))
        .limit(1);
      if (!deal) return { kind: 'no_deal' as const };
      if (deal.stageId === data.stageId) return { kind: 'noop' as const, dealId: deal.id };

      await tx
        .update(deals)
        .set({ stageId: data.stageId, position: 0, updatedAt: new Date() })
        .where(eq(deals.id, deal.id));
      await tx.insert(dealHistory).values({
        dealId: deal.id,
        workspaceId: ctx.workspaceId,
        eventType: 'stage_changed',
        fromValue: { stageId: deal.stageId },
        toValue: { stageId: data.stageId },
        actorType: 'system',
        metadata: { via: 'flow', flowId: ctx.flowId, executionId: ctx.executionId },
      });
      return {
        kind: 'moved' as const,
        dealId: deal.id,
        fromStageId: deal.stageId,
        toStageId: data.stageId,
      };
    });

    if (moved.kind === 'stage_not_found') {
      ctx.log('error', 'move_stage: stage destino inexistente', { stageId: data.stageId });
      return { status: 'SUCCESS' };
    }
    if (moved.kind === 'no_deal') {
      ctx.log('warn', 'move_stage: contato sem deal aberto no pipeline', {
        contactId: ctx.contactId,
      });
      return { status: 'SUCCESS' };
    }
    if (moved.kind === 'noop') {
      return { status: 'SUCCESS' };
    }
    ctx.log('info', 'move_stage: deal movido', {
      dealId: moved.dealId,
      fromStageId: moved.fromStageId,
      toStageId: moved.toStageId,
    });
    return { status: 'SUCCESS' };
  },
};
