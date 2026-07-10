/**
 * Dispatcher da engine (FLOW_BUILDER.md secao 3.2). Algoritmo deterministico de um step de
 * flow, mais os entrypoints de ciclo de vida (trigger/resume/cancel).
 *
 * Puro em relacao a infra: recebe FlowEngineDeps (ports). O index.ts wireia a impl real;
 * os testes injetam fakes.
 *
 * ## Concorrencia (F56-S13 / INF-04)
 * Todo step comeca com um CLAIM atomico (`FlowDbPort.claimExecution`): dois envelopes
 * concorrentes do mesmo executionId nunca executam em paralelo — exatamente um reivindica.
 * Envelope que perde o claim:
 *  - `terminal`/`not_due`/`not_found` → duplicado absorvido (drop silencioso; ack);
 *  - `in_flight` → lanca {@link FlowStepInFlightError}: o retry ladder do MQ (F56-S12)
 *    re-tenta com backoff; se o detentor morreu no meio do step, o lease expira e um
 *    retry posterior faz takeover — recuperacao pos-crash sem duplicar side effects.
 * Os patches de fim de step sao FENCED (`expectStatus: ['processing']`): um step que
 * perdeu o claim (cancel concorrente / takeover) tem a transicao recusada e NAO re-enfileira.
 *
 * ## Anti-loop (F56-S13 / INF-05)
 * O claim incrementa `step_count`; acima de {@link FLOW_MAX_STEPS} a execucao falha com
 * "loop suspeito" — um flow ciclico deixa de flodar a fila indefinidamente.
 */
import type {
  ExecutionPatch,
  FlowClaimResult,
  FlowEngineDeps,
  FlowExecutionEvent,
  FlowExecutionPublicStatus,
  LoadedExecution,
} from './deps';
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

/**
 * Teto de steps por execucao (INF-05). Generoso para flows legitimos (um flow de 50 nodes
 * com dezenas de ciclos de espera/menu fica ordens de magnitude abaixo); um ciclo sem
 * espera estoura em segundos e a execucao falha em vez de flodar a fila para sempre.
 */
export const FLOW_MAX_STEPS = 1000;

/**
 * Outro consumer detem o claim do step (status `processing` dentro do lease). Transitorio
 * por contrato: o consumer do worker deixa o retry ladder (F56-S12) re-tentar com backoff —
 * e assim que um crash no meio do step e recuperado (takeover apos o lease expirar).
 */
export class FlowStepInFlightError extends Error {
  override readonly name = 'FlowStepInFlightError';
  constructor(readonly executionId: string) {
    super(`flow step em voo por outro consumer (executionId=${executionId})`);
  }
}

export interface TriggerFlowInput {
  workspaceId: string;
  flowId: string;
  conversationId?: string;
  contactId?: string;
  triggerData?: Record<string, unknown>;
  triggeredBy: 'manual' | 'automatic' | 'api';
  triggeredByMemberId?: string;
}

/**
 * Notifica mudança de estado (F51). Best-effort: NUNCA propaga erro — uma falha de socket
 * jamais pode abortar um step de flow. Só emite em transições relevantes (criação/waiting/
 * terminal/resume), nunca em running→running (anti-ruído).
 */
async function emitEvent(deps: FlowEngineDeps, event: FlowExecutionEvent): Promise<void> {
  try {
    await deps.events?.executionChanged(event);
  } catch {
    /* best-effort */
  }
}

/** Monta o evento a partir de uma execução carregada. */
function execEvent(
  exec: LoadedExecution,
  status: FlowExecutionPublicStatus,
  nextStepAt: Date | null,
): FlowExecutionEvent {
  return {
    workspaceId: exec.workspaceId,
    executionId: exec.executionId,
    flowId: exec.flowId,
    conversationId: exec.conversationId,
    status,
    nextStepAt,
  };
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
  await emitEvent(deps, {
    workspaceId: input.workspaceId,
    executionId,
    flowId: input.flowId,
    conversationId: input.conversationId ?? null,
    status: 'running',
    nextStepAt: null,
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
    sleep(ms: number) {
      return new Promise<void>((resolve) => setTimeout(resolve, ms));
    },
  };
}

export async function processFlowStep(deps: FlowEngineDeps, executionId: string): Promise<void> {
  const claim = await deps.db.claimExecutionByIdOnly(executionId);
  await runClaimed(deps, claim, executionId);
}

export async function processFlowStepScoped(
  deps: FlowEngineDeps,
  workspaceId: string,
  executionId: string,
): Promise<void> {
  const claim = await deps.db.claimExecution(workspaceId, executionId);
  await runClaimed(deps, claim, executionId);
}

/**
 * Decide o destino do envelope a partir do resultado do claim (ver doc do modulo):
 * reivindicou → teto anti-loop e step; nao reivindicou → drop (duplicado absorvido) ou
 * throw transitorio (`in_flight` → retry ladder cobre crash do detentor).
 */
async function runClaimed(
  deps: FlowEngineDeps,
  claim: FlowClaimResult,
  executionId: string,
): Promise<void> {
  if (!claim.claimed) {
    switch (claim.reason) {
      case 'not_found':
        deps.logger.log('warn', 'flow execution nao encontrada', { executionId });
        return;
      case 'terminal':
      case 'not_due':
        // Envelope duplicado/prematuro: a execucao ja terminou ou o scheduler a acordara
        // no prazo. Absorvido sem side effects (era ISTO que duplicava mensagem).
        deps.logger.log('debug', 'flow step: envelope absorvido (sem claim)', {
          executionId,
          reason: claim.reason,
        });
        return;
      case 'in_flight':
        throw new FlowStepInFlightError(executionId);
    }
    return;
  }

  const exec = claim.execution;
  if (exec.stepCount > FLOW_MAX_STEPS) {
    await failLoopSuspect(deps, exec);
    return;
  }
  await runStep(deps, exec);
}

/** Teto anti-loop excedido (INF-05): falha a execucao em vez de flodar a fila. */
async function failLoopSuspect(deps: FlowEngineDeps, exec: LoadedExecution): Promise<void> {
  const node = findNode(exec.nodes, exec.currentNodeId);
  const error = `loop suspeito: execucao excedeu o teto de ${FLOW_MAX_STEPS} steps (step_count=${exec.stepCount})`;
  deps.logger.log('error', 'flow step: teto anti-loop excedido — execucao falhada', {
    executionId: exec.executionId,
    flowId: exec.flowId,
    stepCount: exec.stepCount,
    currentNodeId: exec.currentNodeId,
  });
  await persistFailure(deps, exec, node ?? { id: 'loop_guard', type: 'loop_guard', data: {} }, error);
}

async function runStep(deps: FlowEngineDeps, exec: LoadedExecution): Promise<void> {
  const node = findNode(exec.nodes, exec.currentNodeId) ?? entryNode(exec.nodes);
  if (!node) {
    const applied = await deps.db.patchExecution(
      exec.workspaceId,
      exec.executionId,
      { status: 'completed', completedAt: deps.now() },
      { expectStatus: ['processing'] },
    );
    if (applied) await emitEvent(deps, execEvent(exec, 'completed', null));
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
    const nextStepAt = new Date(result.nextStepAt);
    const applied = await deps.db.patchExecution(
      exec.workspaceId,
      exec.executionId,
      { status: 'waiting', currentNodeId: node.id, variables: mergedVars, nextStepAt },
      { expectStatus: ['processing'] },
    );
    if (applied) await emitEvent(deps, execEvent(exec, 'waiting', nextStepAt));
    else logLostClaim(deps, exec, 'waiting');
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

/** Perdeu o claim entre o handler e o patch final (cancel concorrente / takeover de lease). */
function logLostClaim(deps: FlowEngineDeps, exec: LoadedExecution, transition: string): void {
  deps.logger.log('warn', 'flow step: claim perdido — transicao descartada', {
    executionId: exec.executionId,
    transition,
  });
}

async function advance(
  deps: FlowEngineDeps,
  exec: LoadedExecution,
  target: string | undefined,
  variables: Record<string, unknown>,
): Promise<void> {
  if (!target) {
    const applied = await deps.db.patchExecution(
      exec.workspaceId,
      exec.executionId,
      { status: 'completed', currentNodeId: null, variables, completedAt: deps.now() },
      { expectStatus: ['processing'] },
    );
    if (applied) await emitEvent(deps, execEvent(exec, 'completed', null));
    else logLostClaim(deps, exec, 'completed');
    return;
  }
  // running→running (avança para o próximo node): NÃO emite (anti-ruído).
  const applied = await deps.db.patchExecution(
    exec.workspaceId,
    exec.executionId,
    { status: 'running', currentNodeId: target, variables },
    { expectStatus: ['processing'] },
  );
  if (!applied) {
    // Sem o claim, re-enfileirar duplicaria/ressuscitaria a execucao (ex.: cancelada em voo).
    logLostClaim(deps, exec, 'running');
    return;
  }
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
  const applied = await deps.db.patchExecution(
    exec.workspaceId,
    exec.executionId,
    {
      status: 'failed',
      lastError: error,
      ...(variables ? { variables } : {}),
      completedAt: deps.now(),
    },
    { expectStatus: ['processing'] },
  );
  if (applied) await emitEvent(deps, execEvent(exec, 'failed', null));
  else logLostClaim(deps, exec, 'failed');
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
    // Fenced em `waiting`: se um step reivindicou a execucao neste meio-tempo (timeout em
    // voo), o resume nao sobrescreve o estado — evita fork execução dupla (INF-04).
    const applied = await deps.db.patchExecution(
      exec.workspaceId,
      exec.executionId,
      { status: 'running', variables },
      { expectStatus: ['waiting'] },
    );
    if (!applied) continue;
    await emitEvent(deps, execEvent(exec, 'running', null));
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
  // Fenced em nao-terminal: cancelar vence um step em voo (`processing`) — o patch final
  // do step, fenced em `processing`, sera recusado e nao ressuscita a execucao.
  const applied = await deps.db.patchExecution(
    workspaceId,
    executionId,
    { status: 'cancelled', lastError: reason ?? null, completedAt: deps.now() },
    { expectStatus: ['running', 'waiting', 'processing'] },
  );
  if (applied) await emitEvent(deps, execEvent(exec, 'cancelled', null));
}

export async function cancelAllForConversation(
  deps: FlowEngineDeps,
  conversationId: string,
): Promise<number> {
  const active = await deps.db.findActiveByConversation(conversationId);
  let count = 0;
  for (const exec of active) {
    const applied = await deps.db.patchExecution(
      exec.workspaceId,
      exec.executionId,
      { status: 'cancelled', completedAt: deps.now() },
      { expectStatus: ['running', 'waiting', 'processing'] },
    );
    if (!applied) continue;
    await emitEvent(deps, execEvent(exec, 'cancelled', null));
    count += 1;
  }
  return count;
}

export type { ExecutionPatch };
