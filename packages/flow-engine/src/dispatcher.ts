/**
 * Dispatcher da engine (FLOW_BUILDER.md secao 3.2). Algoritmo deterministico de um step de
 * flow, mais os entrypoints de ciclo de vida (trigger/resume/cancel).
 *
 * Puro em relacao a infra: recebe FlowEngineDeps (ports). O index.ts wireia a impl real;
 * os testes injetam fakes.
 */
import type { ExecutionPatch, FlowEngineDeps, LoadedExecution } from './deps';
import { getHandler } from './registry';
import type {
  FlowEdge,
  FlowExecutionContext,
  FlowHttpRequest,
  FlowLogLevel,
  FlowNode,
  FlowOutboundMessage,
  FlowPresenceAction,
} from './types';

export interface TriggerFlowInput {
  workspaceId: string;
  flowId: string;
  conversationId?: string;
  contactId?: string;
  triggerData?: Record<string, unknown>;
  triggeredBy: 'manual' | 'automatic' | 'api';
  triggeredByMemberId?: string;
}

export async function triggerFlow(
  deps: FlowEngineDeps,
  input: TriggerFlowInput,
): Promise<{ executionId: string }> {
  const variables: Record<string, unknown> = { trigger: input.triggerData ?? {} };
  const { executionId } = await deps.db.createExecution({
    workspaceId: input.workspaceId,
    flowId: input.flowId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    triggeredBy: input.triggeredBy,
    triggeredByMemberId: input.triggeredByMemberId,
    variables,
  });
  await deps.queue.enqueueStep({ workspaceId: input.workspaceId, executionId });
  return { executionId };
}

function nextNodeId(
  edges: readonly FlowEdge[],
  fromNodeId: string,
  edgeHandle: string | undefined,
): string | undefined {
  const candidates = edges.filter((e) => e.source === fromNodeId);
  if (candidates.length === 0) return undefined;
  if (edgeHandle !== undefined) {
    const byHandle = candidates.find((e) => (e.sourceHandle ?? undefined) === edgeHandle);
    return byHandle?.target;
  }
  const def = candidates.find((e) => e.sourceHandle === undefined || e.sourceHandle === null);
  return (def ?? candidates[0])?.target;
}

function findNode(nodes: readonly FlowNode[], nodeId: string | null): FlowNode | undefined {
  if (!nodeId) return undefined;
  return nodes.find((n) => n.id === nodeId);
}

function entryNode(nodes: readonly FlowNode[]): FlowNode | undefined {
  return nodes.find((n) => n.type === 'trigger') ?? nodes[0];
}

function buildContext(
  deps: FlowEngineDeps,
  exec: LoadedExecution,
  variables: Record<string, unknown>,
): FlowExecutionContext {
  return {
    workspaceId: exec.workspaceId,
    executionId: exec.executionId,
    flowId: exec.flowId,
    conversationId: exec.conversationId,
    contactId: exec.contactId,
    variables,
    async sendMessage(message: FlowOutboundMessage) {
      await deps.outbound.sendMessage(exec.workspaceId, message);
    },
    async sendPresence(action: FlowPresenceAction) {
      await deps.outbound.sendPresence(exec.workspaceId, action);
    },
    async setConversationAi(in0) {
      if (!exec.conversationId) return;
      await deps.outbound.setConversationAi(exec.workspaceId, {
        conversationId: exec.conversationId,
        aiMode: in0.aiMode,
        agentId: in0.agentId,
      });
    },
    async setConversationStatus(status: string) {
      if (!exec.conversationId) return;
      await deps.outbound.setConversationStatus(exec.workspaceId, {
        conversationId: exec.conversationId,
        status,
      });
    },
    async httpRequest(req: FlowHttpRequest) {
      return deps.http.request(req);
    },
    log(level: FlowLogLevel, message: string, payload?: Record<string, unknown>) {
      deps.logger.log(level, message, { executionId: exec.executionId, ...payload });
    },
    now() {
      return deps.now();
    },
  };
}

export async function processFlowStep(deps: FlowEngineDeps, executionId: string): Promise<void> {
  const exec = await deps.db.loadExecutionByIdOnly(executionId);
  if (!exec) {
    deps.logger.log('warn', 'flow execution nao encontrada', { executionId });
    return;
  }
  await runStep(deps, exec);
}

export async function processFlowStepScoped(
  deps: FlowEngineDeps,
  workspaceId: string,
  executionId: string,
): Promise<void> {
  const exec = await deps.db.loadExecution(workspaceId, executionId);
  if (!exec) {
    deps.logger.log('warn', 'flow execution nao encontrada', { workspaceId, executionId });
    return;
  }
  await runStep(deps, exec);
}

async function runStep(deps: FlowEngineDeps, exec: LoadedExecution): Promise<void> {
  if (exec.status !== 'running' && exec.status !== 'waiting') return;

  const node = findNode(exec.nodes, exec.currentNodeId) ?? entryNode(exec.nodes);
  if (!node) {
    await deps.db.patchExecution(exec.workspaceId, exec.executionId, {
      status: 'completed',
      completedAt: deps.now(),
    });
    return;
  }

  const resolve = deps.resolveHandler ?? getHandler;
  const handler = resolve(node.type);
  const variables: Record<string, unknown> = { ...exec.variables };
  const ctx = buildContext(deps, exec, variables);

  if (!handler) {
    await persistFailure(deps, exec, node, `handler desconhecido para node.type=${node.type}`);
    return;
  }

  let result;
  try {
    result = await handler.execute(node as FlowNode<unknown>, ctx);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await persistFailure(deps, exec, node, error);
    return;
  }

  await deps.db.insertLog({
    executionId: exec.executionId,
    workspaceId: exec.workspaceId,
    nodeId: node.id,
    nodeType: node.type,
    level: result.status === 'ERROR' ? 'error' : 'info',
    message: `node ${node.type} -> ${result.status}`,
    payload: { status: result.status },
  });

  const resultVars = 'variables' in result ? result.variables : undefined;
  const rawMergedVars = resultVars ? { ...variables, ...resultVars } : variables;

  // Extrai marcadores de encadeamento (go_to_flow) antes de persistir as vars.
  // Limpar aqui garante idempotencia: re-entrega do job nao dispara o filho duas vezes.
  const gotoFlowExecutionId =
    typeof rawMergedVars['_goto_flow_execution_id'] === 'string'
      ? (rawMergedVars['_goto_flow_execution_id'] as string)
      : undefined;
  const mergedVars =
    gotoFlowExecutionId !== undefined
      ? (({ _goto_flow_execution_id: _a, _goto_flow_initiated: _b, ...rest }) => rest)(
          rawMergedVars as Record<string, unknown> & {
            _goto_flow_execution_id: string;
            _goto_flow_initiated: unknown;
          },
        )
      : rawMergedVars;

  if (result.status === 'WAITING') {
    await deps.db.patchExecution(exec.workspaceId, exec.executionId, {
      status: 'waiting',
      currentNodeId: node.id,
      variables: mergedVars,
      nextStepAt: new Date(result.nextStepAt),
    });
    return;
  }

  if (result.status === 'ERROR') {
    const fallback = readFallbackHandle(node);
    if (fallback !== undefined) {
      const target = nextNodeId(exec.edges, node.id, fallback);
      await advance(deps, exec, target, mergedVars);
      return;
    }
    await persistFailure(deps, exec, node, result.error, mergedVars);
    return;
  }

  const target = nextNodeId(exec.edges, node.id, result.edgeHandle);
  await advance(deps, exec, target, mergedVars);

  // Apos completar (ou transicionar) o step do flow atual, enfileira o primeiro step
  // do flow filho criado pelo handler go_to_flow.  A flag foi removida das vars
  // persistidas acima — re-entrega do job outbound nao dispara o filho novamente.
  if (gotoFlowExecutionId !== undefined) {
    deps.logger.log('info', 'dispatcher: enfileirando step do flow filho (go_to_flow)', {
      parentExecutionId: exec.executionId,
      childExecutionId: gotoFlowExecutionId,
    });
    await deps.queue.enqueueStep({ workspaceId: exec.workspaceId, executionId: gotoFlowExecutionId });
  }
}

function readFallbackHandle(node: FlowNode): string | undefined {
  const data = node.data;
  if (data && typeof data === 'object' && 'fallbackEdgeHandle' in data) {
    const v = (data as Record<string, unknown>)['fallbackEdgeHandle'];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

async function advance(
  deps: FlowEngineDeps,
  exec: LoadedExecution,
  target: string | undefined,
  variables: Record<string, unknown>,
): Promise<void> {
  if (!target) {
    await deps.db.patchExecution(exec.workspaceId, exec.executionId, {
      status: 'completed',
      currentNodeId: null,
      variables,
      completedAt: deps.now(),
    });
    return;
  }
  await deps.db.patchExecution(exec.workspaceId, exec.executionId, {
    status: 'running',
    currentNodeId: target,
    variables,
  });
  await deps.queue.enqueueStep({ workspaceId: exec.workspaceId, executionId: exec.executionId });
}

async function persistFailure(
  deps: FlowEngineDeps,
  exec: LoadedExecution,
  node: FlowNode,
  error: string,
  variables?: Record<string, unknown>,
): Promise<void> {
  await deps.db.insertLog({
    executionId: exec.executionId,
    workspaceId: exec.workspaceId,
    nodeId: node.id,
    nodeType: node.type,
    level: 'error',
    message: error,
  });
  await deps.db.patchExecution(exec.workspaceId, exec.executionId, {
    status: 'failed',
    lastError: error,
    ...(variables ? { variables } : {}),
    completedAt: deps.now(),
  });
}

export async function resumeFlowWithResponse(
  deps: FlowEngineDeps,
  input: { conversationId: string; responseType: string; responseContent: string },
): Promise<void> {
  const active = await deps.db.findActiveByConversation(input.conversationId);
  for (const exec of active) {
    if (exec.status !== 'waiting') continue;
    if (exec.variables['waiting_for_response'] !== true) continue;
    const variables: Record<string, unknown> = {
      ...exec.variables,
      responded: true,
      last_response: input.responseContent,
      last_response_type: input.responseType,
      response_edge: input.responseType,
    };
    await deps.db.patchExecution(exec.workspaceId, exec.executionId, {
      status: 'running',
      variables,
    });
    await deps.queue.enqueueStep({ workspaceId: exec.workspaceId, executionId: exec.executionId });
  }
}

export async function cancelFlowExecution(
  deps: FlowEngineDeps,
  workspaceId: string,
  executionId: string,
  reason?: string,
): Promise<void> {
  const exec = await deps.db.loadExecution(workspaceId, executionId);
  if (!exec) return;
  if (exec.status === 'completed' || exec.status === 'failed' || exec.status === 'cancelled')
    return;
  await deps.db.patchExecution(workspaceId, executionId, {
    status: 'cancelled',
    lastError: reason ?? null,
    completedAt: deps.now(),
  });
}

export async function cancelAllForConversation(
  deps: FlowEngineDeps,
  conversationId: string,
): Promise<number> {
  const active = await deps.db.findActiveByConversation(conversationId);
  let count = 0;
  for (const exec of active) {
    await deps.db.patchExecution(exec.workspaceId, exec.executionId, {
      status: 'cancelled',
      completedAt: deps.now(),
    });
    count += 1;
  }
  return count;
}

export type { ExecutionPatch };
