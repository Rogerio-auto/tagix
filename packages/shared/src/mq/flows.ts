/**
 * Contrato da fila de execucao de flows `hm.q.flow.execution` (FLOW_BUILDER.md §3.2/§6).
 *
 * A engine (`@hm/flow-engine`) e a PRODUTORA (producer-owns-contract): ao disparar um flow
 * e a cada step que precisa continuar, publica `{ workspaceId, executionId }`. O worker de
 * flows (F4-S03) consome e chama `processFlowStep(executionId)`. Envelope minimo de
 * proposito: o worker recarrega `flow_execution` + `flow_version` do banco sob RLS.
 *
 * Dois caminhos de publicação:
 * - **outbox (F70-S25)**: o passo que nasce de uma transição da execução (criação,
 *   avanço, retomada, flow filho do `go_to_flow`, recuperação de `running` parada) é
 *   gravado com {@link flowExecutionStepOutbox} NA transação da transição, direto na fila
 *   pelo exchange padrão. Sem janela entre "a execução avançou" e "o passo foi publicado";
 * - **publish direto**: o wakeup do scheduler (`waiting` vencida) republica a cada tick
 *   até alguém reivindicar, então não precisa de outbox. Usa o exchange `hm.events` com
 *   {@link FLOW_EXECUTION_ROUTING_KEY} (bind `hm.q.flow.execution.#`, ver `assertTopology`).
 *
 * Duplicata é inofensiva por construção: o claim atômico do consumer (F56-S13) garante
 * que cada passo roda uma vez só.
 */
import { z } from 'zod';
import { makeEnvelope } from './envelope';
import { queueJobOutbox, type OutboxMessage } from './outbox';
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

/**
 * Passo de flow → mensagem da outbox (`hm.q.flow.execution`, exchange padrão). Grave com
 * `enqueueOutbox(tx, …)` na transação que cria ou transiciona a execução.
 */
export function flowExecutionStepOutbox(workspaceId: string, executionId: string): OutboxMessage {
  const payload: FlowExecutionStepPayload = flowExecutionStepPayloadSchema.parse({
    workspaceId,
    executionId,
  });
  return queueJobOutbox(
    QUEUES.flowExecution,
    makeEnvelope(FLOW_EXECUTION_STEP_TYPE, workspaceId, payload),
  );
}
