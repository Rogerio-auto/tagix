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

// Aceita `stageId` (UUID — flows da UI) OU `stage` (nome — templates de nicho, resolvido em
// runtime). Os Niche Blueprints referenciam o estágio por nome porque o UUID só existe após
// a provisionagem; resolver aqui conserta os templates sem reescrever o snapshot do flow.
const moveStageSchema = z
  .object({
    stageId: z.string().uuid().optional(),
    stage: z.string().min(1).optional(),
    pipelineId: z.string().uuid().optional(),
  })
  .refine((d) => d.stageId !== undefined || d.stage !== undefined, {
    message: 'move_stage exige stageId ou stage',
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
      // Resolve o stage destino por id (UI) ou por nome (templates de nicho).
      const [target] = data.stageId
        ? await tx.select().from(stages).where(eq(stages.id, data.stageId)).limit(1)
        : await tx
            .select()
            .from(stages)
            .where(and(eq(stages.workspaceId, ctx.workspaceId), eq(stages.name, data.stage!)))
            .limit(1);
      if (!target) return { kind: 'stage_not_found' as const };
      const targetStageId = target.id;

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
      if (deal.stageId === targetStageId) return { kind: 'noop' as const, dealId: deal.id };

      await tx
        .update(deals)
        .set({ stageId: targetStageId, position: 0, updatedAt: new Date() })
        .where(eq(deals.id, deal.id));
      await tx.insert(dealHistory).values({
        dealId: deal.id,
        workspaceId: ctx.workspaceId,
        eventType: 'stage_changed',
        fromValue: { stageId: deal.stageId },
        toValue: { stageId: targetStageId },
        actorType: 'system',
        metadata: { via: 'flow', flowId: ctx.flowId, executionId: ctx.executionId },
      });
      return {
        kind: 'moved' as const,
        dealId: deal.id,
        fromStageId: deal.stageId,
        toStageId: targetStageId,
      };
    });

    if (moved.kind === 'stage_not_found') {
      ctx.log('error', 'move_stage: stage destino inexistente', {
        stage: data.stageId ?? data.stage,
      });
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
