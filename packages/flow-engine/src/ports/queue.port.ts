/**
 * Queue port: re-enqueue de steps em `hm.q.flow.execution` (FLOW_BUILDER.md secao 3.2).
 *
 * A engine e a PRODUTORA do contrato (producer-owns-contract). O publisher concreto
 * (canal RabbitMQ) e injetado pela API/worker via `createQueuePort`. O default e um
 * in-memory sink (testes/uso sincrono) que apenas guarda os envelopes.
 */
import {
  FLOW_EXECUTION_ROUTING_KEY,
  FLOW_EXECUTION_STEP_TYPE,
  makeEnvelope,
  type Envelope,
} from '@hm/shared/mq';
import type { FlowQueuePort } from '../deps';

export interface EnvelopePublisher {
  publish(routingKey: string, envelope: Envelope): void;
}

export function createQueuePort(publisher: EnvelopePublisher): FlowQueuePort {
  return {
    async enqueueStep(input) {
      const envelope = makeEnvelope(FLOW_EXECUTION_STEP_TYPE, input.workspaceId, {
        workspaceId: input.workspaceId,
        executionId: input.executionId,
      });
      publisher.publish(FLOW_EXECUTION_ROUTING_KEY, envelope);
    },
  };
}

/** Sink em memoria (default): guarda os steps enfileirados sem MQ real. */
export function createInMemoryQueuePort(): FlowQueuePort & {
  drained: { workspaceId: string; executionId: string }[];
} {
  const drained: { workspaceId: string; executionId: string }[] = [];
  return {
    drained,
    async enqueueStep(input) {
      drained.push({ workspaceId: input.workspaceId, executionId: input.executionId });
    },
  };
}
