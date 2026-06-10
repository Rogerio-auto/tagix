/**
 * Worker de execucao de flows (F4-S03). Consome `hm.q.flow.execution` (produzida pela
 * engine `@hm/flow-engine` ao disparar/continuar um flow) e processa UM step por mensagem
 * via `processFlowStepScoped`. Re-enqueue do proximo step e responsabilidade da propria
 * engine (queue port com publish real, injetado aqui) — mantendo um unico caminho.
 *
 * ```
 * consume hm.q.flow.execution → valida Envelope (Zod, em consume)
 *   → parseFlowExecutionStep (payload { workspaceId, executionId })
 *   → engine.processFlowStepScoped(workspaceId, executionId)
 *   → ack (sucesso) | nack→DLX (erro transitorio, re-lanca)
 * ```
 *
 * Idempotencia: o guard de status do dispatcher (so processa running|waiting) torna a
 * re-entrega RabbitMQ segura. Falha transitoria (DB/MQ) re-lanca → nack→DLX (a fila nao
 * trava); payload invalido e logado e ack'd (reprocessar nao ajuda).
 */
import {
  connectMq,
  consume,
  parseFlowExecutionStep,
  publish,
  QUEUES,
  type Envelope,
  type MqHandle,
} from '@hm/shared/mq';
import { createFlowEngine, createQueuePort, type FlowEngineApi } from '@hm/flow-engine';
import type { Logger } from '@hm/logger';

type MqChannel = MqHandle['channel'];

/** Fila consumida (nome read-only de @hm/shared/mq; declarada na topologia por F4-S02). */
export const FLOW_EXECUTION_QUEUE = QUEUES.flowExecution;

export interface FlowWorkerDeps {
  readonly engine: FlowEngineApi;
  readonly logger: Logger;
}

/**
 * Liga uma engine cujo queue port publica de verdade em `hm.q.flow.execution` pelo
 * `channel` AMQP injetado (re-enqueue de steps). Usado pelo bootstrap.
 */
export function createFlowWorkerDeps(channel: MqChannel, logger: Logger): FlowWorkerDeps {
  const queue = createQueuePort({
    publish(routingKey, envelope) {
      publish(channel, routingKey, envelope);
    },
  });
  const engine = createFlowEngine({ queue });
  return { engine, logger };
}

/** Processa um unico envelope (testavel sem RabbitMQ). Re-lanca em falha transitoria. */
export async function handleFlowExecutionEnvelope(
  envelope: Envelope,
  deps: FlowWorkerDeps,
): Promise<void> {
  const parsed = (() => {
    try {
      return parseFlowExecutionStep(envelope.payload);
    } catch {
      return null;
    }
  })();
  if (parsed === null) {
    deps.logger.warn('flow-exec: payload invalido — descartado', { envelopeId: envelope.id });
    return;
  }

  const { workspaceId, executionId } = parsed;
  await deps.engine.processFlowStepScoped(workspaceId, executionId);
}

export interface FlowWorkerOptions {
  readonly deps: FlowWorkerDeps;
  readonly logger: Logger;
}

export interface FlowWorkerHandle {
  stop(): Promise<void>;
}

/** Inicia o consumer de `hm.q.flow.execution`. */
export async function startFlowWorker(options: FlowWorkerOptions): Promise<FlowWorkerHandle> {
  const { deps, logger } = options;
  const { connection, channel } = await connectMq();
  await channel.assertQueue(FLOW_EXECUTION_QUEUE, { durable: true });
  await channel.prefetch(8);

  await consume(channel, FLOW_EXECUTION_QUEUE, async (envelope) => {
    await handleFlowExecutionEnvelope(envelope, deps);
  });

  logger.info('flow-execution worker iniciado', { queue: FLOW_EXECUTION_QUEUE });

  return {
    async stop(): Promise<void> {
      await channel.close();
      await connection.close();
      logger.info('flow-execution worker parado', { queue: FLOW_EXECUTION_QUEUE });
    },
  };
}

export type { MqChannel };
