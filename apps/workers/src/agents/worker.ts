/**
 * Worker de agentes (F2-S11, AGENTS_LANGGRAPH §3.4/§8/§10).
 *
 * Consome o evento de "rodar agente" — enfileirado por F1-S26 em `hm.q.flows`
 * (`type: 'flow.run.requested'`) quando uma conversa com `ai_mode='on'` recebe
 * uma nova mensagem inbound — e delega cada gatilho a `runAgent` (`run.ts`):
 *
 * ```
 * consume hm.q.flows → valida Envelope (Zod, em `consume`)
 *   → filtra type === 'flow.run.requested'  (outros tipos de flow não são deste worker)
 *   → parseAgentRunTrigger (Zod do payload de F1-S26)
 *   → runAgent (resolve-policy → cost-guard → client.run → persist + enqueue outbound)
 *   → ack/nack
 * ```
 *
 * `consume` de `@hm/shared/mq` já valida o `Envelope`, faz `ack` em sucesso e
 * `nack(requeue=false)→DLX` se o handler lançar. Gatilho de **conteúdo** inválido
 * (payload malformado, type alheio) NÃO lança: loga-warn e ack'a (reprocessar um
 * payload imutável não ajuda). `runAgent` trata as falhas de **negócio** (sem
 * contexto, cap, modelo bloqueado, erro do runtime) sem lançar. Só erro de
 * **infra** (DB/socket/enqueue) propaga → nack→DLX.
 *
 * Mira a MESMA fila do stub de F1-S26 (`hm.q.flows`); até o flow-engine
 * determinístico (F2 futuro) existir, todo envelope `flow.run.requested` é de
 * agente. Quando o flow-engine entrar, este worker filtra por `type` e ignora os
 * que não forem de agente (já implementado abaixo).
 */
import { z } from 'zod';
import { Buffer } from 'node:buffer';
import {
  connectMq,
  consume,
  makeEnvelope,
  QUEUES,
  type Envelope,
  type MqHandle,
} from '@hm/shared/mq';
import { CHANNEL_PROVIDERS } from '@hm/shared';
import { createAgentsClient } from '@hm/agents-client';
import type { Logger } from '@hm/logger';
import {
  DbAgentRunStore,
  runAgent,
  type AgentRunDeps,
  type AgentOutboundEnqueueInput,
  type AgentOutboundEnqueuePort,
  type AgentRunSocketPort,
  type AgentExecutionEmit,
} from './run';
import type { ServerToClientEvent } from '@hm/shared';

/** Canal AMQP derivado de `@hm/shared/mq` (sem dep direta de `amqplib`). */
type MqChannel = MqHandle['channel'];

/** Fila consumida (mesma do stub de F1-S26: `QUEUES.flows`). */
export const AGENT_QUEUE = QUEUES.flows;

/** Fila de relay de socket (mesma constante de `apps/api/src/socket/relay.ts`). */
export const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

/** Fila canônica de outbound (reusa o pipeline de envio de F1). */
export const OUTBOUND_QUEUE = QUEUES.outbound;

/** Tipo do envelope de disparo (espelha `INBOUND_FLOW_TYPE` de F1-S26). */
export const AGENT_RUN_TYPE = 'flow.run.requested' as const;

/** Tipo do envelope outbound (espelha `OUTBOUND_JOB_TYPE` de `apps/api`). */
export const OUTBOUND_JOB_TYPE = 'outbound.job' as const;

/**
 * Envelope de gatilho publicado por F1-S26 (`MqInboundFlowEnqueue`). Espelha o
 * payload exato de `apps/workers/src/inbound/db-ports.ts`:
 * `{ conversationId, contactId, channelId, provider, triggerExternalId }`.
 * `workspaceId` vem do `Envelope`, não do payload.
 */
export const agentRunTriggerSchema = z.object({
  conversationId: z.string().min(1),
  contactId: z.string().min(1),
  channelId: z.string().min(1),
  provider: z.enum(CHANNEL_PROVIDERS),
  triggerExternalId: z.string().min(1).optional(),
});

export type AgentRunTrigger = z.infer<typeof agentRunTriggerSchema>;

// ─── Portas MQ default (socket relay + outbound enqueue) ──────────────────────

/** Publica `{ event, target:{conversationId}, data }` no relay → room conversation:{id}. */
function relaySocket(
  channel: MqChannel,
  workspaceId: string,
  event: ServerToClientEvent,
  conversationId: string,
  data: unknown,
): void {
  const envelope = makeEnvelope('socket.relay', workspaceId, {
    event,
    target: { conversationId },
    data,
  });
  channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
}

/**
 * Socket default: emite `agent_execution:started`/`agent_execution:completed`
 * via `hm.q.socket.relay` (consumido por `relay.ts`). NB: o relay valida `event`
 * contra `SERVER_TO_CLIENT_EVENTS` — só esses dois eventos de agente existem hoje
 * (não há evento tipado token-a-token — ver REPORT).
 */
export class MqAgentRunSocketEmit implements AgentRunSocketPort {
  constructor(private readonly channel: MqChannel) {}

  async emitStarted(input: AgentExecutionEmit): Promise<void> {
    relaySocket(this.channel, input.workspaceId, 'agent_execution:started', input.conversationId, {
      conversationId: input.conversationId,
      agentId: input.agentId,
      executionId: input.executionId,
    });
    await Promise.resolve();
  }

  async emitCompleted(input: AgentExecutionEmit): Promise<void> {
    relaySocket(
      this.channel,
      input.workspaceId,
      'agent_execution:completed',
      input.conversationId,
      {
        conversationId: input.conversationId,
        agentId: input.agentId,
        executionId: input.executionId,
      },
    );
    await Promise.resolve();
  }
}

/**
 * Enfileiramento default da resposta do agente em `hm.q.outbound`. Monta um
 * `OutboundJob` kind `text` no shape EXATO de `parseOutboundJob`
 * (`apps/workers/src/outbound/job.ts`) — o worker outbound consome, valida e
 * dispara ao provider (reusa todo o pipeline de envio de F1).
 */
export class MqAgentOutboundEnqueue implements AgentOutboundEnqueuePort {
  constructor(private readonly channel: MqChannel) {}

  async enqueueText(input: AgentOutboundEnqueueInput): Promise<void> {
    const job = {
      kind: 'text',
      channelId: input.channelId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      chatId: input.chatId,
      text: input.text,
    };
    const envelope = makeEnvelope(OUTBOUND_JOB_TYPE, input.workspaceId, job);
    this.channel.sendToQueue(OUTBOUND_QUEUE, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      contentType: 'application/json',
    });
    await Promise.resolve();
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export interface AgentWorkerOptions {
  readonly deps: AgentRunDeps;
  readonly logger: Logger;
}

/** Config do runtime Python (base URL + token interno compartilhado). */
export interface AgentRuntimeConfig {
  readonly baseUrl: string;
  readonly token: string;
}

/**
 * Lê a config do runtime do ambiente (`AGENT_RUNTIME_URL` + `AGENT_RUNTIME_TOKEN`).
 * Lança cedo se faltar — o worker não deve subir sem destino para o runtime.
 */
export function agentRuntimeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AgentRuntimeConfig {
  const baseUrl = env['AGENT_RUNTIME_URL'];
  const token = env['AGENT_RUNTIME_TOKEN'];
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error('agent-run: AGENT_RUNTIME_URL ausente no ambiente.');
  }
  if (token === undefined || token.length === 0) {
    throw new Error('agent-run: AGENT_RUNTIME_TOKEN ausente no ambiente.');
  }
  return { baseUrl, token };
}

/**
 * Monta as dependências default do worker de agentes a partir da infra real:
 * store DIRETO `@hm/db`+RLS, socket via fila de relay, cliente do runtime
 * (`@hm/agents-client`) e enqueue outbound. O `channel` AMQP é o do consumer.
 */
export function createAgentDeps(
  channel: MqChannel,
  runtime: AgentRuntimeConfig,
  logger: Logger,
): AgentRunDeps {
  return {
    store: new DbAgentRunStore(),
    socket: new MqAgentRunSocketEmit(channel),
    client: createAgentsClient({ baseUrl: runtime.baseUrl, token: runtime.token }),
    outbound: new MqAgentOutboundEnqueue(channel),
    logger,
  };
}

/**
 * Processa um único envelope (testável sem RabbitMQ). Lança apenas em falha de
 * infra dentro de `runAgent` — o caller (`consume`) converte em nack. Conteúdo
 * inválido (type alheio, payload malformado) loga-warn e retorna sem lançar.
 */
export async function handleAgentEnvelope(
  envelope: Envelope,
  options: AgentWorkerOptions,
): Promise<void> {
  const { deps, logger } = options;

  // Outros tipos de evento em `hm.q.flows` (flow-engine determinístico futuro)
  // não são deste worker — ignora sem lançar.
  if (envelope.type !== AGENT_RUN_TYPE) {
    logger.debug('agent-run: envelope de outro tipo — ignorado', { type: envelope.type });
    return;
  }

  const parsed = agentRunTriggerSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    logger.warn('agent-run: payload de gatilho inválido — descartado', {
      envelopeId: envelope.id,
      type: envelope.type,
    });
    return;
  }

  await runAgent(envelope.workspaceId, parsed.data, deps);
}

export interface AgentWorkerHandle {
  stop(): Promise<void>;
}

/**
 * Inicia o consumer de `hm.q.flows` (gatilhos de agente). Conecta ao RabbitMQ,
 * garante a fila e registra o handler. Retorna um handle para parada limpa.
 */
export async function startAgentWorker(
  options: AgentWorkerOptions,
): Promise<AgentWorkerHandle> {
  const { logger } = options;
  const { connection, channel } = await connectMq();
  await channel.assertQueue(AGENT_QUEUE, { durable: true });
  await channel.prefetch(8);

  await consume(channel, AGENT_QUEUE, async (envelope) => {
    await handleAgentEnvelope(envelope, options);
  });

  logger.info('agent worker iniciado', { queue: AGENT_QUEUE });

  return {
    async stop(): Promise<void> {
      await channel.close();
      await connection.close();
      logger.info('agent worker parado', { queue: AGENT_QUEUE });
    },
  };
}
