/**
 * Worker de execucao de flows (F4-S03). Consome `hm.q.flow.execution` (produzida pela
 * engine `@hm/flow-engine` ao disparar/continuar um flow) e processa UM step por mensagem
 * via `processFlowStepScoped`. O proximo step e gravado pela propria engine, na OUTBOX, na
 * transacao que avanca a execucao (F70-S25) — o relay publica depois do commit.
 *
 * ```
 * consume hm.q.flow.execution → valida Envelope (Zod, em consume)
 *   → parseFlowExecutionStep (payload { workspaceId, executionId })
 *   → assinatura da empresa inativa (F71-S06) → execucao `cancelled` com
 *     `skipped_subscription_inactive`, nenhum step roda, nada e enviado → ack
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
  QUEUES,
  type Envelope,
  type MqHandle,
} from '@hm/shared/mq';
import { createFlowEngine, createOutboundPort, type FlowEngineApi } from '@hm/flow-engine';
import type { Logger } from '@hm/logger';
import {
  recordSubscriptionSkip,
  SKIPPED_SUBSCRIPTION_INACTIVE,
  subscriptionGate,
  type SubscriptionGate,
} from '../lib/subscription-gate';
import { createOutboundPublisher } from './outbound-publisher';
import { createFlowEventsPublisher } from './execution-events-publisher';

type MqChannel = MqHandle['channel'];

/** Fila consumida (nome read-only de @hm/shared/mq; declarada na topologia por F4-S02). */
export const FLOW_EXECUTION_QUEUE = QUEUES.flowExecution;

export interface FlowWorkerDeps {
  readonly engine: FlowEngineApi;
  readonly logger: Logger;
  /** Portão de assinatura (F71-S06). Obrigatório: lido do banco a cada step. */
  readonly subscription: SubscriptionGate;
}

/**
 * Liga a engine do worker: o outbound port envia mensagem de verdade (F31-S01) —
 * `createOutboundPublisher` persiste a message `pending` sob RLS, resolve midia via storage
 * e grava o `OutboundJob` na outbox na mesma transacao. O proximo step sai do port de banco
 * da engine, tambem pela outbox (F70-S25). Usado pelo bootstrap.
 */
export function createFlowWorkerDeps(logger: Logger): FlowWorkerDeps {
  const outbound = createOutboundPort(createOutboundPublisher({ logger }));
  // F51: notifica o cockpit em tempo real publicando flow_execution:updated no socket relay.
  const events = createFlowEventsPublisher({ logger });
  const engine = createFlowEngine({ outbound, events });
  return { engine, logger, subscription: subscriptionGate };
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

  // F71-S06: empresa sem assinatura ativa nao executa passo (passo de flow e automacao de
  // saida). A execucao termina `cancelled` — terminal, entao o wakeup e a recuperacao de
  // `running` nao a republicam em loop, e nada dispara sozinho quando a assinatura voltar.
  const subscription = await deps.subscription.check(workspaceId);
  if (!subscription.active) {
    await deps.engine.cancelFlowExecution(workspaceId, executionId, SKIPPED_SUBSCRIPTION_INACTIVE);
    recordSubscriptionSkip(deps.logger, 'flow-step', workspaceId, subscription.status, {
      executionId,
    });
    return;
  }

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
