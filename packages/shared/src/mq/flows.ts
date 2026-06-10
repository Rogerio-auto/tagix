/**
 * Contrato da fila de execucao de flows `hm.q.flow.execution` (FLOW_BUILDER.md §3.2/§6).
 *
 * A engine (`@hm/flow-engine`) e a PRODUTORA (producer-owns-contract): ao disparar um flow
 * e a cada step que precisa continuar, publica `{ workspaceId, executionId }`. O worker de
 * flows (F4-S03) consome e chama `processFlowStep(executionId)`. Envelope minimo de
 * proposito: o worker recarrega `flow_execution` + `flow_version` do banco sob RLS.
 *
 * Routing key bind: `hm.q.flow.execution.#` (ver `assertTopology`). Publicamos com
 * `hm.q.flow.execution.step` via `publish(channel, FLOW_EXECUTION_ROUTING_KEY, envelope)`.
 */
import { z } from 'zod';
import { QUEUES } from './topology';

/** `type` do envelope (campo `type` do Envelope padrao). */
export const FLOW_EXECUTION_STEP_TYPE = 'flow.execution.step' as const;

/** Routing key de publicacao (bind da fila `hm.q.flow.execution`). */
export const FLOW_EXECUTION_ROUTING_KEY = `${QUEUES.flowExecution}.step` as const;

/**
 * Payload do envelope `flow.execution.step`. Minimo: o worker relê a execucao
 * (`flow_executions` + `flow_versions`) a partir de `executionId` sob RLS do workspace.
 */
export const flowExecutionStepPayloadSchema = z.object({
  workspaceId: z.string().uuid(),
  executionId: z.string().uuid(),
});

export type FlowExecutionStepPayload = z.infer<typeof flowExecutionStepPayloadSchema>;

/** Valida e estreita o payload de um envelope `flow.execution.step` (consumo, F4-S03). */
export function parseFlowExecutionStep(payload: unknown): FlowExecutionStepPayload {
  return flowExecutionStepPayloadSchema.parse(payload);
}
