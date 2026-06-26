/**
 * @hm/flow-engine — engine de execucao de flows (deterministica, NAO agentic).
 *
 * API publica (FLOW_BUILDER.md secao 3.1) consumida por API (F4-S08), worker (F4-S03) e
 * dispatcher inbound (F4-S13). O nucleo (dispatcher) e puro: opera sobre `FlowEngineDeps`.
 * Aqui compomos os ports reais (DB/HTTP/outbound) com defaults; `createFlowEngine` permite
 * injecao (worker liga o publisher RabbitMQ real; testes injetam fakes).
 */
import { createLogger } from '@hm/logger';
import * as core from './dispatcher';
import type { FlowEngineDeps, FlowLoggerPort, FlowQueuePort } from './deps';
import { flowDbPort } from './ports/db.port';
import { flowHttpPort } from './ports/http.port';
import { flowOutboundPort } from './ports/outbound.port';
import { createInMemoryQueuePort } from './ports/queue.port';

const baseLogger = createLogger('info', { pkg: '@hm/flow-engine' });
const loggerPort: FlowLoggerPort = {
  log(level, message, fields) {
    baseLogger[level](message, fields);
  },
};

/** Liga uma engine com ports injetados. O worker passa o queue port com MQ real. */
export function createFlowEngine(overrides: Partial<FlowEngineDeps> = {}): FlowEngineApi {
  const deps: FlowEngineDeps = {
    db: overrides.db ?? flowDbPort,
    queue: overrides.queue ?? defaultQueuePort,
    outbound: overrides.outbound ?? flowOutboundPort,
    http: overrides.http ?? flowHttpPort,
    logger: overrides.logger ?? loggerPort,
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

// Default queue port: in-memory sink ate o worker (F4-S03) injetar o MQ real.
const defaultQueuePort: FlowQueuePort = createInMemoryQueuePort();

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
export {
  validateFlow,
  type FlowValidationInput,
  type FlowValidationIssue,
  type FlowValidationResult,
  type FlowValidationSeverity,
} from './validation';
export { interpolate, extractVarReferences } from './utils/interpolate';
export {
  createQueuePort,
  createInMemoryQueuePort,
  type EnvelopePublisher,
} from './ports/queue.port';
export { createOutboundPort, type OutboundPublisher } from './ports/outbound.port';
export { MESSAGE_PRE_ACTION_MAX_MS, MESSAGE_DELAY_MAX_MS } from './handlers/message.handler';
export * from './backup';
export type { TriggerFlowInput } from './dispatcher';

export const FLOW_ENGINE_PKG = '@hm/flow-engine' as const;
