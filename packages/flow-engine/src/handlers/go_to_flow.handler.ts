/**
 * Handler `go_to_flow` (F31-S11). Encerra a execucao atual e transfere o contato
 * para outro flow publicado do workspace.
 *
 * DESIGN:
 *   1. Guard de profundidade: le `_flow_depth` das variables; se >= MAX_DEPTH (5),
 *      aborta com ERROR (anti-loop).
 *   2. Cria a nova execucao do flow alvo (withWorkspace + schema, igual a
 *      register_conversion e outros handlers system-authoritative), propagando
 *      conversationId/contactId e incrementando `_flow_depth`.
 *   3. Grava `_goto_flow_execution_id` + `_goto_flow_initiated` nas variables da
 *      execucao corrente para que o dispatcher (worker) a enfileire apos o step.
 *   4. Retorna SUCCESS sem edge — o dispatcher completa a execucao atual.
 *
 * SEAM ABERTO: o dispatcher (apps/workers/src/flows/worker.ts) ainda nao le
 * `_goto_flow_execution_id` e nao enfileira o step do flow alvo. A criacao da
 * execucao ja ocorre corretamente; o worker precisa de uma linha apos runStep:
 *
 *   const newExId = exec.variables['_goto_flow_execution_id'];
 *   if (typeof newExId === 'string') {
 *     await deps.queue.enqueueStep({ workspaceId: exec.workspaceId, executionId: newExId });
 *   }
 *
 * Ate esse wire ser adicionado, o flow alvo fica criado mas nao e executado.
 */
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import type { FlowHandler } from '../types';

const MAX_DEPTH = 5;

const goToFlowSchema = z.object({
  /** flow alvo (flows.id) para onde a execucao sera transferida. */
  flowId: z.string().optional(),
});

type GoToFlowData = z.infer<typeof goToFlowSchema>;

const { flows, flowVersions, flowExecutions } = schema;

export const goToFlowHandler: FlowHandler<GoToFlowData> = {
  schema: goToFlowSchema,
  async execute(node, ctx) {
    const data = goToFlowSchema.parse(node.data);

    if (!data.flowId) {
      ctx.log('warn', 'go_to_flow: flowId nao configurado; no-op', { nodeType: 'go_to_flow' });
      return { status: 'SUCCESS' };
    }

    // Guard de profundidade: evita ciclos de encadeamento infinito.
    const depth =
      typeof ctx.variables['_flow_depth'] === 'number' ? (ctx.variables['_flow_depth'] as number) : 0;
    if (depth >= MAX_DEPTH) {
      ctx.log('error', 'go_to_flow: limite de profundidade de encadeamento atingido', {
        depth,
        maxDepth: MAX_DEPTH,
        targetFlowId: data.flowId,
      });
      return {
        status: 'ERROR',
        error: `go_to_flow: limite de ${MAX_DEPTH} flows encadeados atingido`,
      };
    }

    // Cria a execucao do flow alvo dentro do mesmo workspace.
    const outcome = await withWorkspace(ctx.workspaceId, async (tx) => {
      const [flow] = await tx
        .select({ id: flows.id, status: flows.status })
        .from(flows)
        .where(and(eq(flows.id, data.flowId!), eq(flows.workspaceId, ctx.workspaceId)))
        .limit(1);

      if (!flow) return { kind: 'flow_not_found' as const };
      if (flow.status !== 'active') return { kind: 'flow_not_active' as const };

      const [version] = await tx
        .select({ id: flowVersions.id, nodes: flowVersions.nodes })
        .from(flowVersions)
        .where(eq(flowVersions.flowId, data.flowId!))
        .orderBy(desc(flowVersions.version))
        .limit(1);

      if (!version) return { kind: 'no_version' as const };

      // Resolve o trigger node como ponto de entrada.
      const nodes = Array.isArray(version.nodes) ? (version.nodes as { id: string; type: string }[]) : [];
      const trigger = nodes.find((n) => n.type === 'trigger') ?? nodes[0];

      const initialVars: Record<string, unknown> = {
        trigger: {},
        _flow_depth: depth + 1,
        ...(ctx.conversationId ? { _parent_conversation_id: ctx.conversationId } : {}),
      };

      const [exec] = await tx
        .insert(flowExecutions)
        .values({
          workspaceId: ctx.workspaceId,
          flowId: data.flowId!,
          flowVersionId: version.id,
          conversationId: ctx.conversationId,
          contactId: ctx.contactId,
          triggeredBy: 'automatic',
          status: 'running',
          currentNodeId: trigger?.id ?? null,
          variables: initialVars,
        })
        .returning({ id: flowExecutions.id });

      if (!exec) return { kind: 'creation_failed' as const };
      return { kind: 'created' as const, executionId: exec.id };
    });

    if (outcome.kind === 'flow_not_found') {
      ctx.log('error', 'go_to_flow: flow alvo nao encontrado', { flowId: data.flowId });
      return { status: 'ERROR', error: `go_to_flow: flow ${data.flowId} nao encontrado` };
    }
    if (outcome.kind === 'flow_not_active') {
      ctx.log('warn', 'go_to_flow: flow alvo nao esta ativo; no-op', { flowId: data.flowId });
      return { status: 'SUCCESS' };
    }
    if (outcome.kind === 'no_version') {
      ctx.log('error', 'go_to_flow: flow alvo sem versao publicada', { flowId: data.flowId });
      return { status: 'ERROR', error: `go_to_flow: flow ${data.flowId} sem versao publicada` };
    }
    if (outcome.kind === 'creation_failed') {
      ctx.log('error', 'go_to_flow: falha ao criar execucao do flow alvo', { flowId: data.flowId });
      return { status: 'ERROR', error: 'go_to_flow: falha ao criar execucao' };
    }

    ctx.log('info', 'go_to_flow: execucao do flow alvo criada', {
      targetFlowId: data.flowId,
      targetExecutionId: outcome.executionId,
      depth: depth + 1,
    });

    // Expoe o ID da nova execucao para o dispatcher enfileirar apos completar o step atual.
    return {
      status: 'SUCCESS',
      variables: {
        _goto_flow_execution_id: outcome.executionId,
        _goto_flow_initiated: true,
      },
    };
  },
};
