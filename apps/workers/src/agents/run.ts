/**
 * Orquestração de UMA execução de agente (F2-S11, AGENTS_LANGGRAPH §3.4/§8/§10).
 *
 * Recebe o gatilho já parseado (uma conversa com `ai_mode='on'` que recebeu uma
 * nova mensagem inbound — enfileirado por F1-S26 em `hm.q.flows`) e materializa o
 * turno de resposta do agente:
 *
 * ```
 * load (RLS): conversa + agente ativo + texto do gatilho + histórico
 *   ai_mode != 'on' | sem agente ativo  → skip (no-op, ack)
 * resolvePolicy(ws, agentId)            → PolicySnapshot (wire) + cap/spend
 * estimateCostUsd (teto conservador)    → guardResolved
 *   deny → registra execução failed + agent_execution:completed → stop
 * insert agent_executions (running) + agent_execution:started
 * client.run({ ..., policy_snapshot })  → consome o stream:
 *   token              → acumula a reply (relay de token-a-token é F2 futuro — ver REPORT)
 *   tool_call_started  → (observável; sem persistência nesta fase)
 *   tool_call_completed→ (idem)
 *   model_blocked      → marca execução failed + completed → stop
 *   final              → reply + usage  (fonte da resposta do agente)
 * persist message (outbound, pending, sender_type='agent') + enqueue hm.q.outbound
 * mark agent_executions completed (tokens/cost) + agent_execution:completed
 *   AgentRuntimeError (incl. evento `error` do runtime) → marca failed + completed
 * ```
 *
 * Tudo que toca DB roda sob `withWorkspace` (RLS). As portas (DB / socket /
 * agents-client / enqueue) são injetadas para o handler ser testável sem
 * RabbitMQ, sem Postgres e sem o runtime Python.
 */
import { and, desc, eq } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import type { DbTx } from '@hm/db';
import type { Logger } from '@hm/logger';
import {
  estimateCostUsd,
  guardResolved,
  resolvePolicy,
  type ResolvedPolicy,
} from '@hm/agents-core';
import type {
  AgentRunRequest,
  AgentsClient,
  AgentStreamEvent,
  ChatMessage,
  RunOptions,
} from '@hm/agents-client';
import { AgentRuntimeError } from '@hm/agents-client';
import type { AgentRunTrigger } from './worker';

/** Quantas mensagens recentes carregar como histórico para o runtime. */
export const HISTORY_LIMIT = 20;

// ─── Portas injetáveis ────────────────────────────────────────────────────────

/** Snapshot da conversa + agente ativo + gatilho, resolvido sob RLS. */
export interface AgentRunContext {
  readonly conversationId: string;
  /** Id do contato no provider (`conversations.remote_id`) — `chatId` do outbound. */
  readonly chatId: string;
  readonly channelId: string;
  readonly aiMode: string;
  readonly agentId: string;
  readonly agentStatus: string;
  /** Texto do turno novo (a mensagem que disparou o agente). */
  readonly userInput: string;
  /** Histórico recente (do mais antigo ao mais novo) já no shape do runtime. */
  readonly history: ChatMessage[];
}

/** Acesso a DB do run — implementação default em `@hm/db` (RLS). */
export interface AgentRunStore {
  /**
   * Resolve o contexto do run (conversa + agente ativo + gatilho + histórico).
   * `null` quando a conversa sumiu, não tem agente associado, ou o agente não
   * está ativo (nada a executar — o caller ack'a).
   */
  loadContext(
    workspaceId: string,
    trigger: AgentRunTrigger,
  ): Promise<AgentRunContext | null>;
  /** Cria a linha de `agent_executions` em `running`. Retorna o `executionId`. */
  startExecution(input: StartExecutionInput): Promise<string>;
  /** Marca a execução como `completed` (tokens/cost reais do `final`). */
  completeExecution(input: CompleteExecutionInput): Promise<void>;
  /** Marca a execução como `failed` com o motivo. */
  failExecution(input: FailExecutionInput): Promise<void>;
  /**
   * Persiste a mensagem do agente (outbound, `pending`, `sender_type='agent'`).
   * Retorna o `messageId` para correlação do job outbound.
   */
  persistAgentMessage(input: PersistAgentMessageInput): Promise<string>;
}

export interface StartExecutionInput {
  readonly workspaceId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly threadId: string;
}

export interface CompleteExecutionInput {
  readonly workspaceId: string;
  readonly executionId: string;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
}

export interface FailExecutionInput {
  readonly workspaceId: string;
  readonly executionId: string;
  readonly error: string;
}

export interface PersistAgentMessageInput {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly agentId: string;
  readonly content: string;
}

/** Emite os eventos `agent_execution:*` (relay → room `conversation:{id}`). */
export interface AgentRunSocketPort {
  emitStarted(input: AgentExecutionEmit): Promise<void>;
  emitCompleted(input: AgentExecutionEmit): Promise<void>;
}

export interface AgentExecutionEmit {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly agentId: string;
  readonly executionId: string;
}

/** Enfileira o job outbound (reusa `hm.q.outbound`) com a resposta do agente. */
export interface AgentOutboundEnqueuePort {
  enqueueText(input: AgentOutboundEnqueueInput): Promise<void>;
}

export interface AgentOutboundEnqueueInput {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly chatId: string;
  readonly messageId: string;
  readonly text: string;
}

/** Dependências de uma execução de agente. */
export interface AgentRunDeps {
  readonly store: AgentRunStore;
  readonly socket: AgentRunSocketPort;
  readonly client: AgentsClient;
  readonly outbound: AgentOutboundEnqueuePort;
  readonly logger: Logger;
}

// ─── Orquestração ─────────────────────────────────────────────────────────────

/** Resultado observável de um run (log/teste). */
export type AgentRunOutcome =
  | { readonly status: 'skipped'; readonly reason: 'no_context' | 'ai_off' | 'agent_inactive' }
  | { readonly status: 'budget_denied'; readonly executionId: string }
  | { readonly status: 'runtime_blocked'; readonly executionId: string; readonly reason: string }
  | { readonly status: 'failed'; readonly executionId: string; readonly error: string }
  | { readonly status: 'replied'; readonly executionId: string; readonly messageId: string };

/**
 * Custo estimado (teto conservador) do turno: prompt assumido ~= histórico+input
 * em tokens grosseiros, completion = `max_tokens_per_call` da policy. O pricing
 * real é desconhecido aqui (sem snapshot de `llm_models_whitelist` neste boundary),
 * então o `estimateCostUsd` com pricing nulo devolve 0 e o guard só bloqueia
 * quando há cap E gasto já estourado — o custo real é reconciliado em
 * `llm_usage_logs` (gravado pelo runtime). Mantém a barreira de cap sem inflar.
 */
function estimateTurnCostUsd(resolved: ResolvedPolicy, ctx: AgentRunContext): number {
  const promptChars =
    ctx.userInput.length + ctx.history.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  // ~4 chars/token (heurística OpenAI). Teto de completion = policy.
  const promptTokens = Math.ceil(promptChars / 4);
  const completionTokens = resolved.policy.maxTokensPerCall;
  // Pricing desconhecido neste boundary → null (não infla; cap real reconciliado).
  return estimateCostUsd(
    { promptTokens, completionTokens },
    { promptPer1m: null, completionPer1m: null },
  );
}

/** Monta o `AgentRunRequest` (snake_case no wire) a partir do contexto + snapshot. */
function buildRunRequest(
  workspaceId: string,
  ctx: AgentRunContext,
  resolved: ResolvedPolicy,
): AgentRunRequest {
  return {
    workspace_id: workspaceId,
    agent_id: ctx.agentId,
    conversation_id: ctx.conversationId,
    user_input: ctx.userInput,
    messages: ctx.history,
    policy_snapshot: resolved.snapshot,
    // `thread_id` derivado da conversa: um thread de checkpoint estável por conversa.
    thread_id: ctx.conversationId,
  };
}

/**
 * Consome o stream do runtime acumulando a reply e o usage do `final`. Tokens
 * são acumulados (o relay token-a-token via socket depende de um evento de
 * stream tipado que ainda não existe em `@hm/shared` — ver REPORT). `model_blocked`
 * encerra o stream sinalizando bloqueio.
 */
interface StreamOutcome {
  readonly reply: string;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly blockedReason: string | null;
}

async function consumeStream(
  stream: AsyncGenerator<AgentStreamEvent, void, unknown>,
): Promise<StreamOutcome> {
  let accumulated = '';
  let finalReply: string | null = null;
  let totalTokens = 0;
  let totalCostUsd = 0;
  let blockedReason: string | null = null;

  for await (const ev of stream) {
    switch (ev.type) {
      case 'token':
        accumulated += ev.content;
        break;
      case 'final':
        finalReply = ev.reply;
        totalTokens = ev.usage.total_tokens ?? ev.usage.prompt_tokens + ev.usage.completion_tokens;
        totalCostUsd = ev.usage.total_cost_usd;
        break;
      case 'model_blocked':
        blockedReason = ev.reason;
        break;
      case 'iteration_exceeded':
        blockedReason = 'iteration_exceeded';
        break;
      case 'budget_exceeded':
        blockedReason = 'budget_exceeded';
        break;
      // tool_call_started / tool_call_completed / interrupt: observáveis,
      // sem persistência nesta fase (tool logs são de outro slot).
      default:
        break;
    }
  }

  return {
    reply: finalReply ?? accumulated,
    totalTokens,
    totalCostUsd,
    blockedReason,
  };
}

/**
 * Executa um turno de agente ponta-a-ponta. Lança apenas em falha de **infra**
 * (DB/MQ/socket) — o caller (`worker`) converte em nack→DLX. Falhas de **negócio**
 * (sem contexto, cap estourado, modelo bloqueado, erro do runtime) são tratadas
 * aqui (marcam a execução, emitem socket) e retornam um outcome sem lançar: o
 * envelope é ack'd (reprocessar um gatilho imutável não ajuda).
 */
export async function runAgent(
  workspaceId: string,
  trigger: AgentRunTrigger,
  deps: AgentRunDeps,
  opts?: RunOptions,
): Promise<AgentRunOutcome> {
  const { store, socket, client, outbound, logger } = deps;

  const ctx = await store.loadContext(workspaceId, trigger);
  if (ctx === null) {
    logger.info('agent-run: sem contexto executável — ignorado', {
      conversationId: trigger.conversationId,
    });
    return { status: 'skipped', reason: 'no_context' };
  }
  if (ctx.aiMode !== 'on') {
    return { status: 'skipped', reason: 'ai_off' };
  }
  if (ctx.agentStatus !== 'active') {
    return { status: 'skipped', reason: 'agent_inactive' };
  }

  const resolved = await resolvePolicy(workspaceId, ctx.agentId);

  // Cost-guard PRÉ-chamada (F2-S09): não dispara o runtime se estouraria o cap.
  const estimatedCostUsd = estimateTurnCostUsd(resolved, ctx);
  const decision = guardResolved(resolved, estimatedCostUsd);
  if (!decision.ok) {
    const executionId = await store.startExecution({
      workspaceId,
      agentId: ctx.agentId,
      conversationId: ctx.conversationId,
      threadId: ctx.conversationId,
    });
    await store.failExecution({ workspaceId, executionId, error: decision.reason });
    await socket.emitCompleted({
      workspaceId,
      conversationId: ctx.conversationId,
      agentId: ctx.agentId,
      executionId,
    });
    logger.warn('agent-run: bloqueado por cap de custo', {
      conversationId: ctx.conversationId,
      agentId: ctx.agentId,
      reason: decision.reason,
      message: decision.message,
    });
    return { status: 'budget_denied', executionId };
  }

  const executionId = await store.startExecution({
    workspaceId,
    agentId: ctx.agentId,
    conversationId: ctx.conversationId,
    threadId: ctx.conversationId,
  });
  await socket.emitStarted({
    workspaceId,
    conversationId: ctx.conversationId,
    agentId: ctx.agentId,
    executionId,
  });

  const request = buildRunRequest(workspaceId, ctx, resolved);

  let stream: StreamOutcome;
  try {
    stream = await consumeStream(client.run(request, opts));
  } catch (err: unknown) {
    // O client lança `AgentRuntimeError` para o evento `error` do runtime e para
    // falhas de transporte/contrato. Marca a execução e notifica; não relança
    // (gatilho imutável — reprocessar não ajuda; o supervisor não deve nack→DLX
    // em erro de modelo). Falha de transporte retryável poderia requeue, mas o
    // ack é mais seguro: a próxima inbound redispara o agente.
    const message = err instanceof AgentRuntimeError ? err.message : String(err);
    await store.failExecution({ workspaceId, executionId, error: message });
    await socket.emitCompleted({
      workspaceId,
      conversationId: ctx.conversationId,
      agentId: ctx.agentId,
      executionId,
    });
    logger.error('agent-run: runtime falhou', {
      conversationId: ctx.conversationId,
      agentId: ctx.agentId,
      executionId,
      retryable: err instanceof AgentRuntimeError ? err.retryable : false,
      error: message,
    });
    return { status: 'failed', executionId, error: message };
  }

  // Modelo bloqueado pela policy (defense-in-depth do runtime): sem resposta.
  if (stream.blockedReason !== null) {
    await store.failExecution({ workspaceId, executionId, error: stream.blockedReason });
    await socket.emitCompleted({
      workspaceId,
      conversationId: ctx.conversationId,
      agentId: ctx.agentId,
      executionId,
    });
    logger.warn('agent-run: execução bloqueada pelo runtime', {
      conversationId: ctx.conversationId,
      agentId: ctx.agentId,
      executionId,
      reason: stream.blockedReason,
    });
    return { status: 'runtime_blocked', executionId, reason: stream.blockedReason };
  }

  const reply = stream.reply.trim();
  if (reply.length === 0) {
    // Final sem texto (ex.: só tool calls): nada a enviar, mas a execução
    // concluiu. Marca completed e encerra sem mensagem outbound.
    await store.completeExecution({
      workspaceId,
      executionId,
      totalTokens: stream.totalTokens,
      totalCostUsd: stream.totalCostUsd,
    });
    await socket.emitCompleted({
      workspaceId,
      conversationId: ctx.conversationId,
      agentId: ctx.agentId,
      executionId,
    });
    logger.info('agent-run: concluída sem resposta de texto', {
      conversationId: ctx.conversationId,
      agentId: ctx.agentId,
      executionId,
    });
    return { status: 'replied', executionId, messageId: '' };
  }

  // Persiste a resposta do agente (outbound, pending) e enfileira o envio real —
  // mesmo pipeline outbound de F1 (o worker outbound dispara ao provider).
  const messageId = await store.persistAgentMessage({
    workspaceId,
    conversationId: ctx.conversationId,
    agentId: ctx.agentId,
    content: reply,
  });

  await outbound.enqueueText({
    workspaceId,
    conversationId: ctx.conversationId,
    channelId: ctx.channelId,
    chatId: ctx.chatId,
    messageId,
    text: reply,
  });

  await store.completeExecution({
    workspaceId,
    executionId,
    totalTokens: stream.totalTokens,
    totalCostUsd: stream.totalCostUsd,
  });
  await socket.emitCompleted({
    workspaceId,
    conversationId: ctx.conversationId,
    agentId: ctx.agentId,
    executionId,
  });

  logger.info('agent-run: resposta gerada e enfileirada', {
    conversationId: ctx.conversationId,
    agentId: ctx.agentId,
    executionId,
    messageId,
    totalTokens: stream.totalTokens,
  });

  return { status: 'replied', executionId, messageId };
}

// ─── Implementação default das portas DB (@hm/db + withWorkspace, RLS) ────────

/**
 * Store default via `@hm/db`. Toda leitura/escrita roda sob RLS
 * (`withWorkspace`). Resolve o agente da conversa por `conversations.agent_id`;
 * o texto do gatilho é a última mensagem inbound da conversa (`triggerExternalId`
 * quando presente, senão a mais recente).
 */
export class DbAgentRunStore implements AgentRunStore {
  async loadContext(
    workspaceId: string,
    trigger: AgentRunTrigger,
  ): Promise<AgentRunContext | null> {
    return withWorkspace(workspaceId, async (tx) => {
      const { conversations, agents } = schema;

      const [conv] = await tx
        .select({
          remoteId: conversations.remoteId,
          channelId: conversations.channelId,
          aiMode: conversations.aiMode,
          agentId: conversations.agentId,
        })
        .from(conversations)
        .where(eq(conversations.id, trigger.conversationId))
        .limit(1);

      if (conv === undefined || conv.agentId === null) return null;

      const [agent] = await tx
        .select({ id: agents.id, status: agents.status })
        .from(agents)
        .where(eq(agents.id, conv.agentId))
        .limit(1);

      if (agent === undefined) return null;

      const userInput = await loadTriggerInput(tx, trigger);
      const history = await loadHistory(tx, trigger.conversationId);

      return {
        conversationId: trigger.conversationId,
        chatId: conv.remoteId,
        channelId: conv.channelId,
        aiMode: conv.aiMode,
        agentId: agent.id,
        agentStatus: agent.status,
        userInput,
        history,
      };
    });
  }

  async startExecution(input: StartExecutionInput): Promise<string> {
    return withWorkspace(input.workspaceId, async (tx) => {
      const [row] = await tx
        .insert(schema.agentExecutions)
        .values({
          workspaceId: input.workspaceId,
          agentId: input.agentId,
          conversationId: input.conversationId,
          threadId: input.threadId,
          status: 'running',
          state: {},
        })
        .returning({ id: schema.agentExecutions.id });
      if (row === undefined) {
        throw new Error('agent-run: execução não materializou após insert.');
      }
      return row.id;
    });
  }

  async completeExecution(input: CompleteExecutionInput): Promise<void> {
    await withWorkspace(input.workspaceId, async (tx) => {
      await tx
        .update(schema.agentExecutions)
        .set({
          status: 'completed',
          totalTokens: input.totalTokens,
          totalCostUsd: input.totalCostUsd.toFixed(6),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.agentExecutions.id, input.executionId));
    });
  }

  async failExecution(input: FailExecutionInput): Promise<void> {
    await withWorkspace(input.workspaceId, async (tx) => {
      await tx
        .update(schema.agentExecutions)
        .set({
          status: 'failed',
          error: input.error,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.agentExecutions.id, input.executionId));
    });
  }

  async persistAgentMessage(input: PersistAgentMessageInput): Promise<string> {
    return withWorkspace(input.workspaceId, async (tx) => {
      const [row] = await tx
        .insert(schema.messages)
        .values({
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          direction: 'outbound',
          senderType: 'agent',
          senderAgentId: input.agentId,
          type: 'text',
          content: input.content,
          viewStatus: 'pending',
          externalId: null,
        })
        .returning({ id: schema.messages.id });
      if (row === undefined) {
        throw new Error('agent-run: mensagem do agente não materializou após insert.');
      }
      return row.id;
    });
  }
}

/** Texto do turno que disparou o agente (última inbound; gatilho por `externalId`). */
async function loadTriggerInput(tx: DbTx, trigger: AgentRunTrigger): Promise<string> {
  const { messages } = schema;

  // Gatilho explícito por externalId (o F1-S26 manda o externalId da última inbound).
  if (trigger.triggerExternalId !== undefined) {
    const [row] = await tx
      .select({ content: messages.content })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, trigger.conversationId),
          eq(messages.externalId, trigger.triggerExternalId),
        ),
      )
      .limit(1);
    if (row?.content != null) return row.content;
  }

  // Fallback: a mensagem inbound mais recente da conversa.
  const [latest] = await tx
    .select({ content: messages.content })
    .from(messages)
    .where(
      and(eq(messages.conversationId, trigger.conversationId), eq(messages.direction, 'inbound')),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);

  return latest?.content ?? '';
}

/**
 * Carrega o histórico recente da conversa (do mais antigo ao mais novo) no shape
 * do runtime: inbound→`user`, outbound→`assistant`. Texto-only (mídia entra
 * noutro slot). Limita a `HISTORY_LIMIT` mensagens.
 */
async function loadHistory(tx: DbTx, conversationId: string): Promise<ChatMessage[]> {
  const { messages } = schema;
  const rows = await tx
    .select({
      direction: messages.direction,
      content: messages.content,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(HISTORY_LIMIT);

  // `rows` vem do mais novo ao mais antigo → reverte para ordem cronológica.
  return rows
    .reverse()
    .filter((r): r is { direction: string; content: string } => r.content != null)
    .map((r) => ({
      role: r.direction === 'inbound' ? 'user' : 'assistant',
      content: r.content,
    }));
}
