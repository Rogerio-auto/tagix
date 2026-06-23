/**
 * Engine de flows do processo da API, com queue port REAL.
 *
 * A engine default exportada por `@hm/flow-engine` usa um sink in-memory (sem consumidor
 * no processo da API): qualquer `triggerFlow` criaria a `flow_execution` em `running` mas
 * NUNCA enfileiraria o primeiro step para o worker — o flow ficaria parado, sem enviar
 * mensagem. Aqui injetamos um `FlowQueuePort` que publica de verdade o step em
 * `hm.q.flow.execution` (exchange `hm.events`, mesma routing key da engine/worker/scheduler),
 * de modo que o worker de flows (F4-S03) processe e ENVIE.
 *
 * O canal AMQP é lazy e compartilhado por processo (mesmo padrão de `conversations/agent.ts`).
 * O publish é aguardado: uma falha sobe como erro (a rota responde 5xx) em vez de devolver
 * um 202 falso com a execução presa.
 */
import {
  connectMq,
  makeEnvelope,
  publish,
  FLOW_EXECUTION_ROUTING_KEY,
  FLOW_EXECUTION_STEP_TYPE,
  type MqHandle,
} from '@hm/shared/mq';
import { createFlowEngine, type FlowQueuePort } from '@hm/flow-engine';

let mqHandlePromise: Promise<MqHandle> | null = null;

async function getMqChannel() {
  mqHandlePromise ??= connectMq();
  try {
    return (await mqHandlePromise).channel;
  } catch (err) {
    mqHandlePromise = null;
    throw err;
  }
}

const flowQueuePort: FlowQueuePort = {
  async enqueueStep(input) {
    const channel = await getMqChannel();
    const envelope = makeEnvelope(FLOW_EXECUTION_STEP_TYPE, input.workspaceId, {
      workspaceId: input.workspaceId,
      executionId: input.executionId,
    });
    publish(channel, FLOW_EXECUTION_ROUTING_KEY, envelope);
  },
};

/** Engine de flows da API: createExecution real (DB/RLS) + enqueue real (RabbitMQ). */
export const flowEngine = createFlowEngine({ queue: flowQueuePort });
