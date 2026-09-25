/**
 * @hm/flow-engine — engine de execucao de flows (deterministica, NAO agentic).
 *
 * API publica (FLOW_BUILDER.md secao 3.1) consumida por API (F4-S08), worker (F4-S03) e
 * dispatcher inbound (F4-S13). O nucleo (dispatcher) e puro: opera sobre `FlowEngineDeps`.
 * Aqui compomos os ports reais (DB/HTTP/outbound) com defaults; `createFlowEngine` permite
 * injecao (worker liga o outbound e os eventos reais; testes injetam fakes).
 *
 * F70-S25: nao ha mais port de fila. O port de banco real grava o job de cada step na
 * outbox, na transacao da execucao — entao a engine default (triggers do inbound, API v1)
 * dispara flows de verdade, e nenhum chamador precisa injetar publisher.
 */
import { createLogger } from '@hm/logger';
import * as core from './dispatcher';
import type { FlowEngineDeps, FlowLoggerPort } from './deps';
import { flowDbPort } from './ports/db.port';
import { flowHttpPort } from './ports/http.port';
import { flowOutboundPort } from './ports/outbound.port';

const baseLogger = createLogger('info', { pkg: '@hm/flow-engine' });
const loggerPort: FlowLoggerPort = {
  log(level, message, fields) {
    baseLogger[level](message, fields);
  },
};

/** Liga uma engine com ports injetados (o worker passa outbound e eventos reais). */
export function createFlowEngine(overrides: Partial<FlowEngineDeps> = {}): FlowEngineApi {
  const deps: FlowEngineDeps = {
    db: overrides.db ?? flowDbPort,
    outbound: overrides.outbound ?? flowOutboundPort,
    http: overrides.http ?? flowHttpPort,
    logger: overrides.logger ?? loggerPort,
    // Port de eventos opcional: wireado pelo worker (socket relay); undefined = no-op.
    events: overrides.events,
    now: overrides.now ?? (() => new Date()),
  };
  return {
    triggerFlow: (input) => core.triggerFlow(deps, input),
    processFlowStep: (executionId) => core.processFlowStep(deps, executionId),
    processFlowStepScoped: (workspaceId, executionId) =>
      core.processFlowStepScoped(deps, workspaceId, executionId),
    resumeFlowWithResponse: (input) => core.resumeFlowWithResponse(deps, input),
    cancelFlowExecution: (workspaceId, executionId, reason) =>
      core.cancelFlowExecution(deps, workspaceId, executionId, reason),
    cancelAllForConversation: (conversationId) =>
      core.cancelAllForConversation(deps, conversationId),
    deps,
  };
}

export interface FlowEngineApi {
  triggerFlow(input: core.TriggerFlowInput): Promise<{ executionId: string }>;
  processFlowStep(executionId: string): Promise<void>;
  processFlowStepScoped(workspaceId: string, executionId: string): Promise<void>;
  resumeFlowWithResponse(input: {
    conversationId: string;
    responseType: string;
    responseContent: string;
  }): Promise<void>;
  cancelFlowExecution(workspaceId: string, executionId: string, reason?: string): Promise<void>;
  cancelAllForConversation(conversationId: string): Promise<number>;
  readonly deps: FlowEngineDeps;
}

// ─── API publica direta (ports default), espelhando FLOW_BUILDER secao 3.1 ───
const defaultEngine = createFlowEngine();

export const triggerFlow = defaultEngine.triggerFlow;
export const processFlowStep = defaultEngine.processFlowStep;
export const processFlowStepScoped = defaultEngine.processFlowStepScoped;
export const resumeFlowWithResponse = defaultEngine.resumeFlowWithResponse;
export const cancelFlowExecution = defaultEngine.cancelFlowExecution;
export const cancelAllForConversation = defaultEngine.cancelAllForConversation;

// ─── Re-exports do contrato (consumidos por handlers, API, worker, validacao) ──
export * from './types';
export * from './deps';
export { handlerRegistry, getHandler, FLOW_NODE_TYPES, type FlowNodeType } from './registry';
// F70-S07 — trava de origem da IA (a mesma usada pelo port de outbound).
export { AI_ELIGIBLE_CONVERSATION_ORIGINS, isConversationAiEligible } from './ai-origin-gate';
export {
  validateFlow,
  type FlowValidationInput,
  type FlowValidationIssue,
  type FlowValidationResult,
  type FlowValidationSeverity,
} from './validation';
export { interpolate, extractVarReferences } from './utils/interpolate';
export { createOutboundPort, type OutboundPublisher } from './ports/outbound.port';
export { MESSAGE_PRE_ACTION_MAX_MS, MESSAGE_DELAY_MAX_MS } from './handlers/message.handler';
export * from './backup';
export type { TriggerFlowInput } from './dispatcher';
// F56-S13: claim atomico + anti-loop. O worker deve deixar FlowStepInFlightError
// propagar para o retry ladder do MQ (recuperacao pos-crash via takeover de lease).
export { FlowStepInFlightError, FLOW_MAX_STEPS } from './dispatcher';
export { FLOW_CLAIM_LEASE_MS } from './ports/db.port';

export const FLOW_ENGINE_PKG = '@hm/flow-engine' as const;
