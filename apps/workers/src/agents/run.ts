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
 *   origem não elegível e sem marca humana posterior ao último `on` automático
 *                                       → skip (F70-S19, fail-closed; ver authorizeAiReply)
 * resolvePolicy(ws, agentId)            → PolicySnapshot (wire) + cap/spend
 * estimateCostUsd (teto conservador)    → guardResolved
 *   deny → registra execução failed + agent_execution:completed → stop
 * loadTools (RLS): agent_tools habilitadas → ToolDescriptor[] (F70-S10)
 *   → filtro da policy (categorias + teto) → `tools` do request
 * insert agent_executions (running) + agent_execution:started
 * client.run({ ..., policy_snapshot })  → consome o stream:
 *   token              → acumula a reply (relay de token-a-token é F2 futuro — ver REPORT)
 *   tool_call_started  → (observável; sem persistência nesta fase)
 *   tool_call_completed→ (idem)
 *   model_blocked      → marca execução failed + completed → stop
 *   final              → reply + usage  (fonte da resposta do agente)
 * persist message (outbound, pending, sender_type='agent') + job em hm.q.outbound pela
 *   OUTBOX, na mesma transação (F70-S21)
 * mark agent_executions completed (tokens/cost) + agent_execution:completed
 *   AgentRuntimeError (incl. evento `error` do runtime) → marca failed + completed
 * ```
 *
 * Tudo que toca DB roda sob `withWorkspace` (RLS). As portas (DB / socket /
 * agents-client) são injetadas para o handler ser testável sem RabbitMQ, sem
 * Postgres e sem o runtime Python.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { agentDepartmentsRepo, enqueueOutbox, schema, withWorkspace } from '@hm/db';
import { makeEnvelope, queueJobOutbox, QUEUES } from '@hm/shared/mq';
import { isConversationAiEligible } from '@hm/flow-engine';
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
  ToolDescriptor,
} from '@hm/agents-client';
import { AgentRuntimeError } from '@hm/agents-client';
import {
  filterToolsByPolicy,
  loadAgentToolRows,
  toToolDescriptors,
  type ToolDescriptorBuild,
} from './tools';
import type { AgentRunTrigger } from './worker';

/** Quantas mensagens recentes carregar como histórico para o runtime. */
export const HISTORY_LIMIT = 20;

/** Tipo do envelope do job de envio (o mesmo da API e dos flows). */
export const OUTBOUND_JOB_TYPE = 'outbound.job' as const;

// ─── Portas injetáveis ────────────────────────────────────────────────────────

/** Snapshot da conversa + agente ativo + gatilho, resolvido sob RLS. */
export interface AgentRunContext {
  readonly conversationId: string;
  /** Id do contato no provider (`conversations.remote_id`) — `chatId` do outbound. */
  readonly chatId: string;
  readonly channelId: string;
  readonly aiMode: string;
  /**
   * `conversations.origin` cru (F70-S07). NULL/desconhecido = `sem-origem`. Junto com as
   * duas marcas abaixo decide se o agente pode responder ({@link authorizeAiReply}).
   */
  readonly origin: string | null;
  /** Última vez que um HUMANO ligou a IA (`conversations.ai_enabled_at`, F70-S19). */
  readonly aiEnabledAt: Date | null;
  /** Última transição automática para `on` (`conversations.ai_auto_enabled_at`, trigger). */
  readonly aiAutoEnabledAt: Date | null;
  readonly agentId: string;
  readonly agentStatus: string;
  /**
   * Contato da conversa (`conversations.contact_id`). Vai como `contact_id` no
   * `/run`: o runtime carrega o contato no prompt e as tools `database`
   * (`query_contact`/`query_deal`) operam sobre ele. Ausente/`null` = sem contato.
   */
  readonly contactId?: string | null;
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
  loadContext(workspaceId: string, trigger: AgentRunTrigger): Promise<AgentRunContext | null>;
  /**
   * Tools habilitadas do agente (`agent_tools` ⋈ `tools`, sob RLS) já no contrato do
   * runtime, ANTES do filtro da policy (aplicado por `runAgent`); `rejected` = keys
   * fora do contrato (descartadas). Opcional: store sem este método roda o agente sem
   * tools (comportamento anterior à F70-S10).
   */
  loadTools?(workspaceId: string, agentId: string): Promise<ToolDescriptorBuild>;
  /** Cria a linha de `agent_executions` em `running`. Retorna o `executionId`. */
  startExecution(input: StartExecutionInput): Promise<string>;
  /** Marca a execução como `completed` (tokens/cost reais do `final`). */
  completeExecution(input: CompleteExecutionInput): Promise<void>;
  /** Marca a execução como `failed` com o motivo. */
  failExecution(input: FailExecutionInput): Promise<void>;
  /**
   * Persiste a mensagem do agente (outbound, `pending`, `sender_type='agent'`) e grava
   * o job de envio em `hm.q.outbound` (kind `text`) na MESMA transação (F70-S21):
   * commit da mensagem e do job é o mesmo. Retorna o `messageId`. Caminho sem gatilho de
   * fila (flush do buffer de agregação); o turno reivindicado usa {@link deliverTurnReply}.
   */
  persistAgentMessage(input: PersistAgentMessageInput): Promise<string>;

  // ─── Reivindicação do turno pelo id do gatilho (F70-S26) ───────────────────
  /**
   * Reivindica o turno do gatilho numa transação curta e ATÔMICA: cria a execução em
   * `claimed` ou retoma a linha existente se ela está em `failed_before_runtime` ou em
   * `claimed` com o lease vencido. Qualquer outro estado devolve o estado atual sem mudar
   * nada. Duas entregas concorrentes: o índice único serializa, só uma sai `acquired`.
   */
  claimTurn(input: ClaimTurnInput): Promise<TurnClaim>;
  /** `claimed` → `running` se o token ainda é o dono. `false` = perdeu a reivindicação. */
  markTurnRunning(input: TurnRef): Promise<boolean>;
  /**
   * `claimed` → `failed_before_runtime` (token conferido): a retentativa da fila pode
   * reivindicar de novo. A execução fica `failed` com o erro até lá.
   */
  releaseTurn(input: TurnRef & { readonly error: string }): Promise<void>;
  /**
   * `running` → `responded` guardando a resposta do runtime (token conferido). A partir
   * daqui uma retentativa grava ESTA resposta, sem chamar o runtime de novo.
   */
  saveTurnReply(input: TurnRef & { readonly reply: string }): Promise<boolean>;
  /**
   * `responded` → `completed` + mensagem do agente + job de envio na outbox, na MESMA
   * transação. A transição condicional é a garantia de UMA mensagem: quem a perde recebe
   * `null` (outra entrega já gravou a resposta) e não grava nada.
   */
  deliverTurnReply(
    input: PersistAgentMessageInput & { readonly executionId: string },
  ): Promise<string | null>;
}

/** Quanto tempo uma reivindicação `claimed` vale antes de outra entrega poder retomá-la. */
export const TURN_CLAIM_LEASE_MS = 120_000;

export interface ClaimTurnInput extends StartExecutionInput {
  /** Id estável do gatilho (`agentRunTriggerId`, `@hm/shared/mq`). */
  readonly triggerId: string;
  /** Lease de `claimed` (default {@link TURN_CLAIM_LEASE_MS}). */
  readonly leaseMs: number;
}

/** Referência a uma reivindicação em posse desta entrega. */
export interface TurnRef {
  readonly workspaceId: string;
  readonly executionId: string;
  readonly token: string;
}

/** Resultado de {@link AgentRunStore.claimTurn}. */
export type TurnClaim =
  | {
      readonly kind: 'acquired';
      readonly executionId: string;
      readonly token: string;
      readonly attempt: number;
    }
  /** Outra entrega reivindicou e ainda está antes do runtime (lease vigente). */
  | { readonly kind: 'in_flight'; readonly executionId: string | null }
  /** O runtime já foi chamado para este gatilho: nunca chama de novo. */
  | { readonly kind: 'running'; readonly executionId: string }
  /** O runtime respondeu, a mensagem ainda não foi gravada: grava a resposta guardada. */
  | { readonly kind: 'responded'; readonly executionId: string; readonly reply: string }
  | { readonly kind: 'completed'; readonly executionId: string };

/**
 * Outra entrega do mesmo gatilho está com o turno, antes do runtime. Lançado para a fila
 * RETENTAR (não é erro de conteúdo): se a dona concluir, a retentativa vira no-op; se ela
 * falhar antes do runtime ou morrer (lease vencido), a retentativa roda o turno. Ack aqui
 * perderia o turno quando a dona falha sem conseguir marcar `failed_before_runtime`.
 */
export class AgentTurnInFlightError extends Error {
  override readonly name = 'AgentTurnInFlightError';
  constructor(readonly triggerId: string) {
    super(`agent-run: turno do gatilho ${triggerId} em curso noutra entrega; retentar.`);
  }
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
  /** Canal da conversa — `channelId` do job de envio. */
  readonly channelId: string;
  /** Id do contato no provider (`conversations.remote_id`) — `chatId` do job. */
  readonly chatId: string;
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

/** Dependências de uma execução de agente. */
export interface AgentRunDeps {
  readonly store: AgentRunStore;
  readonly socket: AgentRunSocketPort;
  readonly client: AgentsClient;
  readonly logger: Logger;
}

// ─── Orquestração ─────────────────────────────────────────────────────────────

/** Resultado observável de um run (log/teste). */
export type AgentRunOutcome =
  | {
      readonly status: 'skipped';
      readonly reason: 'no_context' | 'ai_off' | 'agent_inactive' | 'origin_not_eligible';
    }
  | { readonly status: 'budget_denied'; readonly executionId: string }
  | { readonly status: 'runtime_blocked'; readonly executionId: string; readonly reason: string }
  | { readonly status: 'failed'; readonly executionId: string; readonly error: string }
  | { readonly status: 'replied'; readonly executionId: string; readonly messageId: string }
  /** Gatilho repetido (F70-S26): o turno já rodou ou está no runtime. No-op. */
  | {
      readonly status: 'duplicate';
      readonly executionId: string;
      readonly turnState: 'running' | 'completed' | 'claim_lost';
    };

/** Por que o agente pode responder a esta conversa (ou por que não). */
export type AiReplyAuthorization =
  | { readonly allowed: true; readonly basis: 'origin' | 'human' }
  | { readonly allowed: false };

/**
 * Última barreira da trava de origem (F70-S19, achado M2). `ai_mode='on'` não basta:
 * conversas ligadas antes da trava (legado, sem `origin`) ou por um caminho que a
 * contorne continuariam recebendo resposta automática. O agente só responde se:
 *
 *  - a origem é elegível (mesma regra única da F70-S07: `isConversationAiEligible`,
 *    NULL/desconhecida = `sem-origem`); **ou**
 *  - um humano ligou a IA (`aiEnabledAt`) DEPOIS do último `on` automático
 *    (`aiAutoEnabledAt`, gravado pelo trigger da migração 0088). Um `on` automático
 *    posterior invalida a marca humana antiga.
 *
 * Fail-closed: sem marca, marca inválida ou empate → não responde.
 */
export function authorizeAiReply(
  ctx: Pick<AgentRunContext, 'origin' | 'aiEnabledAt' | 'aiAutoEnabledAt'>,
): AiReplyAuthorization {
  if (isConversationAiEligible(ctx.origin)) return { allowed: true, basis: 'origin' };
  const human = validTime(ctx.aiEnabledAt);
  if (human === null) return { allowed: false };
  const auto = validTime(ctx.aiAutoEnabledAt);
  if (auto !== null && human <= auto) return { allowed: false };
  return { allowed: true, basis: 'human' };
}

function validTime(value: Date | null | undefined): number | null {
  if (!(value instanceof Date)) return null;
  const ms = value.getTime();
  return Number.isFinite(ms) ? ms : null;
}

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

/**
 * Monta o `AgentRunRequest` (snake_case no wire) a partir do contexto + snapshot +
 * tools já filtradas pela policy. Sem tools, o runtime não oferece nenhuma ao modelo.
 *
 * `executionId` (F70-S15) é o `agent_executions.id` criado aqui ANTES do `/run`. O
 * runtime o adota como id da execução: é o que vai no envelope dos callbacks de tool
 * (o endpoint interno confere que a execução é deste agente e está em curso), em
 * `tool_logs.execution_id` e no upsert de `agent_executions` do `finalize` — uma linha
 * só por turno. Viaja em `metadata` porque o contrato Zod de `@hm/agents-client`
 * descarta campos desconhecidos no topo do request.
 */
export function buildRunRequest(
  workspaceId: string,
  ctx: AgentRunContext,
  resolved: ResolvedPolicy,
  tools: readonly ToolDescriptor[],
  executionId?: string,
): AgentRunRequest {
  return {
    workspace_id: workspaceId,
    agent_id: ctx.agentId,
    conversation_id: ctx.conversationId,
    ...(ctx.contactId ? { contact_id: ctx.contactId } : {}),
    user_input: ctx.userInput,
    messages: ctx.history,
    policy_snapshot: resolved.snapshot,
    tools: [...tools],
    // `thread_id` derivado da conversa: um thread de checkpoint estável por conversa.
    thread_id: ctx.conversationId,
    ...(executionId ? { metadata: { execution_id: executionId } } : {}),
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
 * (DB/MQ/socket) — o caller (`worker`) converte em retry da fila. Falhas de **negócio**
 * (sem contexto, cap estourado, modelo bloqueado, erro do runtime) são tratadas
 * aqui (marcam a execução, emitem socket) e retornam um outcome sem lançar: o
 * envelope é ack'd (reprocessar um gatilho imutável não ajuda).
 *
 * ## Turno idempotente por gatilho (F70-S26)
 *
 * Com `trigger.triggerId` (todo envelope da fila; ver `handleAgentEnvelope`), o turno é
 * reivindicado em `agent_executions` pelo id do gatilho DEPOIS das travas (que não têm
 * efeito) e ANTES de qualquer efeito (cap, tools, socket, runtime). `turn_state`:
 *
 * ```
 *  (nada) ──claim──▶ claimed ──markRunning──▶ running ──saveReply──▶ responded ──deliver──▶ completed
 *                    │   ▲                      │                                        ▲
 *        infra antes │   │ retentativa          └─ erro/bloqueio do runtime, resposta ───┘
 *        do runtime  ▼   │ (ou lease vencido)       vazia, cap negado (a partir de claimed)
 *            failed_before_runtime
 * ```
 *
 * Entrega repetida, conforme o estado que encontra:
 *  - `failed_before_runtime`, ou `claimed` com lease ({@link TURN_CLAIM_LEASE_MS}) vencido
 *    (a dona morreu antes do runtime) → reivindica e roda o turno inteiro;
 *  - `claimed` no lease → {@link AgentTurnInFlightError}: a fila retenta mais tarde;
 *  - `running` → no-op. O runtime já foi chamado e pode ter executado tools; chamá-lo de
 *    novo arrisca a segunda resposta e o efeito duplicado. Uma queda NO MEIO do runtime
 *    (processo morto, erro de infra antes de guardar a resposta) deixa o turno sem
 *    resposta: escolha consciente, a próxima mensagem do contato abre outro turno;
 *  - `responded` → grava a resposta guardada sem chamar o runtime (a falha foi depois
 *    dele, ao gravar a mensagem): o cliente recebe a resposta, uma vez;
 *  - `completed` → no-op.
 *
 * A mensagem sai de `deliverTurnReply`, cuja transição condicional `responded → completed`
 * é da mesma transação da mensagem e do job de envio: duas entregas concorrentes nunca
 * gravam duas respostas. Sem `triggerId` (flush do buffer de agregação) o turno roda como
 * antes, sem reivindicação.
 */
export async function runAgent(
  workspaceId: string,
  trigger: AgentRunTrigger,
  deps: AgentRunDeps,
  opts?: RunOptions,
): Promise<AgentRunOutcome> {
  const { store, socket, client, logger } = deps;

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
  const authorization = authorizeAiReply(ctx);
  if (!authorization.allowed) {
    // Antes de policy, execução e runtime: nenhuma execução é gravada e nada é enviado
    // (o único efeito anterior é o agent_id sticky do `loadContext`, inofensivo).
    // `warn` de propósito: IA `on` que não pode responder é estado a corrigir (um humano
    // religa a IA na conversa, se ela deve mesmo ser atendida pelo agente).
    logger.warn('agent-run: IA on sem origem elegível nem marca humana — não responde', {
      conversationId: ctx.conversationId,
      origin: ctx.origin ?? null,
      hasHumanMark: ctx.aiEnabledAt !== null,
    });
    return { status: 'skipped', reason: 'origin_not_eligible' };
  }
  if (ctx.agentStatus !== 'active') {
    return { status: 'skipped', reason: 'agent_inactive' };
  }

  const resolved = await resolvePolicy(workspaceId, ctx.agentId);

  // F70-S26: reivindica o turno pelo id do gatilho (ou abre execução avulsa, sem gatilho).
  const begun = await beginTurn(workspaceId, trigger, ctx, deps);
  if (begun.kind === 'done') return begun.outcome;
  const { executionId, turn } = begun;

  // Antes do runtime: uma falha de infra aqui libera o turno para a retentativa da fila.
  let tools: ToolDescriptor[];
  try {
    // Cost-guard PRÉ-chamada (F2-S09): não dispara o runtime se estouraria o cap.
    const estimatedCostUsd = estimateTurnCostUsd(resolved, ctx);
    const decision = guardResolved(resolved, estimatedCostUsd);
    if (!decision.ok) {
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

    // Tools habilitadas do agente, filtradas pela MESMA policy que o runtime reaplica.
    const loaded = (await store.loadTools?.(workspaceId, ctx.agentId)) ?? {
      tools: [],
      rejected: [],
    };
    const enabledTools = loaded.tools;
    tools = filterToolsByPolicy(enabledTools, resolved.snapshot);
    if (loaded.rejected.length > 0) {
      // Linha de catálogo fora do contrato: nunca derruba o turno; o agente fica sem ela.
      logger.warn('agent-run: tools fora do contrato descartadas', {
        agentId: ctx.agentId,
        rejected: loaded.rejected,
      });
    }
    if (enabledTools.length > 0) {
      logger.info('agent-run: tools entregues ao runtime', {
        conversationId: ctx.conversationId,
        agentId: ctx.agentId,
        executionId,
        tools: tools.map((t) => t.key),
        droppedByPolicy: enabledTools.length - tools.length,
      });
    }

    await socket.emitStarted({
      workspaceId,
      conversationId: ctx.conversationId,
      agentId: ctx.agentId,
      executionId,
    });

    // Último passo antes do runtime: daqui em diante o gatilho nunca chama o runtime de
    // novo. Perder aqui = o lease venceu e outra entrega retomou a MESMA execução.
    if (turn !== null && !(await store.markTurnRunning(turn))) {
      logger.warn('agent-run: reivindicação perdida antes do runtime; outra entrega segue', {
        conversationId: ctx.conversationId,
        executionId,
        triggerId: trigger.triggerId,
      });
      return { status: 'duplicate', executionId, turnState: 'claim_lost' };
    }
  } catch (err: unknown) {
    if (turn !== null) await releaseTurnQuietly(store, turn, err, logger);
    throw err;
  }

  const request = buildRunRequest(workspaceId, ctx, resolved, tools, executionId);

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

  // Persiste a resposta do agente (outbound, pending) e grava o envio real na outbox,
  // na mesma transação — mesmo pipeline outbound de F1 (o worker outbound dispara ao
  // provider). F70-S21: antes o job era publicado depois do commit; uma queda entre os
  // dois deixava a resposta `pending` para sempre.
  const message: PersistAgentMessageInput = {
    workspaceId,
    conversationId: ctx.conversationId,
    agentId: ctx.agentId,
    content: reply,
    channelId: ctx.channelId,
    chatId: ctx.chatId,
  };
  let messageId: string | null;
  if (turn === null) {
    messageId = await store.persistAgentMessage(message);
  } else {
    // F70-S26: guarda a resposta ANTES de gravar a mensagem. Se a gravação falhar, a
    // retentativa da fila encontra `responded` e grava esta resposta sem outro runtime.
    if (!(await store.saveTurnReply({ ...turn, reply }))) {
      // `running` não é retomável; só chega aqui com o estado mexido por fora.
      logger.error('agent-run: turno saiu de running durante o runtime; resposta descartada', {
        conversationId: ctx.conversationId,
        executionId,
        triggerId: trigger.triggerId,
      });
      return { status: 'duplicate', executionId, turnState: 'claim_lost' };
    }
    messageId = await store.deliverTurnReply({ ...message, executionId });
  }

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

  if (messageId === null) {
    // Uma entrega concorrente em `responded` gravou esta resposta primeiro.
    return { status: 'duplicate', executionId, turnState: 'completed' };
  }
  return { status: 'replied', executionId, messageId };
}

// ─── Reivindicação do turno (F70-S26) ─────────────────────────────────────────

type BegunTurn =
  | { readonly kind: 'run'; readonly executionId: string; readonly turn: TurnRef | null }
  | { readonly kind: 'done'; readonly outcome: AgentRunOutcome };

/**
 * Abre a execução do turno. Sem `triggerId`: execução avulsa (`startExecution`). Com ele:
 * reivindica e decide pelo estado encontrado (ver a máquina em {@link runAgent}).
 */
async function beginTurn(
  workspaceId: string,
  trigger: AgentRunTrigger,
  ctx: AgentRunContext,
  deps: AgentRunDeps,
): Promise<BegunTurn> {
  const { store, socket, logger } = deps;
  const base: StartExecutionInput = {
    workspaceId,
    agentId: ctx.agentId,
    conversationId: ctx.conversationId,
    threadId: ctx.conversationId,
  };
  const triggerId = trigger.triggerId;
  if (triggerId === undefined) {
    return { kind: 'run', executionId: await store.startExecution(base), turn: null };
  }

  const claim = await store.claimTurn({ ...base, triggerId, leaseMs: TURN_CLAIM_LEASE_MS });
  const fields = { conversationId: ctx.conversationId, triggerId };
  switch (claim.kind) {
    case 'acquired':
      if (claim.attempt > 1) {
        logger.info('agent-run: retentativa reivindicou o turno (falhou antes do runtime)', {
          ...fields,
          executionId: claim.executionId,
          attempt: claim.attempt,
        });
      }
      return {
        kind: 'run',
        executionId: claim.executionId,
        turn: { workspaceId, executionId: claim.executionId, token: claim.token },
      };
    case 'in_flight':
      logger.info('agent-run: gatilho em curso noutra entrega; a fila retenta', {
        ...fields,
        executionId: claim.executionId,
      });
      throw new AgentTurnInFlightError(triggerId);
    case 'running':
    case 'completed':
      logger.info('agent-run: gatilho repetido; o turno já rodou, nada a fazer', {
        ...fields,
        executionId: claim.executionId,
        turnState: claim.kind,
      });
      return {
        kind: 'done',
        outcome: { status: 'duplicate', executionId: claim.executionId, turnState: claim.kind },
      };
    case 'responded': {
      // A entrega anterior guardou a resposta e caiu ao gravá-la: grava agora, sem runtime.
      const messageId = await store.deliverTurnReply({
        workspaceId,
        conversationId: ctx.conversationId,
        agentId: ctx.agentId,
        content: claim.reply,
        channelId: ctx.channelId,
        chatId: ctx.chatId,
        executionId: claim.executionId,
      });
      if (messageId === null) {
        return {
          kind: 'done',
          outcome: { status: 'duplicate', executionId: claim.executionId, turnState: 'completed' },
        };
      }
      await socket.emitCompleted({
        workspaceId,
        conversationId: ctx.conversationId,
        agentId: ctx.agentId,
        executionId: claim.executionId,
      });
      logger.warn('agent-run: resposta guardada gravada pela retentativa (sem novo runtime)', {
        ...fields,
        executionId: claim.executionId,
        messageId,
      });
      return {
        kind: 'done',
        outcome: { status: 'replied', executionId: claim.executionId, messageId },
      };
    }
  }
}

/**
 * Libera o turno para a retentativa depois de uma falha antes do runtime. Best-effort: se
 * nem isso grava (banco fora), o `claimed` expira pelo lease e a retentativa o retoma.
 */
async function releaseTurnQuietly(
  store: AgentRunStore,
  turn: TurnRef,
  cause: unknown,
  logger: Logger,
): Promise<void> {
  const error = cause instanceof Error ? cause.message : String(cause);
  try {
    await store.releaseTurn({ ...turn, error });
  } catch (releaseErr: unknown) {
    logger.error('agent-run: não liberou o turno; a retentativa espera o lease', {
      executionId: turn.executionId,
      error: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
    });
  }
}

// ─── Implementação default das portas DB (@hm/db + withWorkspace, RLS) ────────

/**
 * Store default via `@hm/db`. Toda leitura/escrita roda sob RLS
 * (`withWorkspace`). Resolução do agente da conversa (F34-S03, department-aware):
 *
 *   1. `conversations.agent_id` já setado  → usa ele (sticky; transferências de
 *      S04/S05 e turnos anteriores persistem aqui).
 *   2. `conversations.department_id` não-nulo → agente de entrada do departamento
 *      (`agentDepartmentsRepo.getDefaultAgentForDepartment`, S01). Achou → usa e
 *      **persiste** em `conversations.agent_id` (sticky) na MESMA transação RLS,
 *      para turnos seguintes e para o cockpit (S04) exibir.
 *   3. Sem dept / dept sem default → sem agente resolvível → `null` (skip, ack).
 *
 * A persistência sticky é idempotente sob concorrência: o `UPDATE` filtra por
 * `agent_id IS NULL`, então um segundo turno que corra em paralelo vê o agente já
 * setado e não sobrescreve.
 *
 * O texto do gatilho é a última mensagem inbound da conversa (`triggerExternalId`
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
          contactId: conversations.contactId,
          aiMode: conversations.aiMode,
          origin: conversations.origin,
          aiEnabledAt: conversations.aiEnabledAt,
          aiAutoEnabledAt: conversations.aiAutoEnabledAt,
          agentId: conversations.agentId,
          departmentId: conversations.departmentId,
        })
        .from(conversations)
        .where(eq(conversations.id, trigger.conversationId))
        .limit(1);

      if (conv === undefined) return null;

      // Resolução do agente (department-aware, F34-S03).
      // 1. Sticky: `agent_id` já fixado na conversa tem precedência absoluta.
      // 2. Senão, agente de entrada (`is_default`) do departamento da conversa.
      // 3. Senão, sem agente resolvível → skip (comportamento atual).
      let resolvedAgentId = conv.agentId;
      let resolvedFromDepartment = false;
      if (resolvedAgentId === null && conv.departmentId !== null) {
        resolvedAgentId = await agentDepartmentsRepo.getDefaultAgentForDepartment(
          tx,
          conv.departmentId,
        );
        resolvedFromDepartment = resolvedAgentId !== null;
      }

      if (resolvedAgentId === null) return null;

      const [agent] = await tx
        .select({ id: agents.id, status: agents.status })
        .from(agents)
        .where(eq(agents.id, resolvedAgentId))
        .limit(1);

      if (agent === undefined) return null;

      // Persistência sticky: quando o agente veio do departamento (não estava
      // fixado), grava-o na conversa na MESMA transação RLS. O filtro
      // `agent_id IS NULL` mantém a escrita idempotente sob concorrência — um
      // turno paralelo que já tenha fixado o agente não é sobrescrito.
      if (resolvedFromDepartment) {
        await tx
          .update(conversations)
          .set({ agentId: agent.id })
          .where(and(eq(conversations.id, trigger.conversationId), isNull(conversations.agentId)));
      }

      const userInput = await loadTriggerInput(tx, trigger);
      const history = await loadHistory(tx, trigger.conversationId);

      return {
        conversationId: trigger.conversationId,
        chatId: conv.remoteId,
        channelId: conv.channelId,
        contactId: conv.contactId ?? null,
        aiMode: conv.aiMode,
        // `?? null`: ausente (linha parcial, store de teste) vira "sem origem / sem marca",
        // que a trava lê como não autorizado (fail-closed).
        origin: conv.origin ?? null,
        aiEnabledAt: conv.aiEnabledAt ?? null,
        aiAutoEnabledAt: conv.aiAutoEnabledAt ?? null,
        agentId: agent.id,
        agentStatus: agent.status,
        userInput,
        history,
      };
    });
  }

  async loadTools(workspaceId: string, agentId: string): Promise<ToolDescriptorBuild> {
    const rows = await withWorkspace(workspaceId, (tx) =>
      loadAgentToolRows(tx, workspaceId, agentId),
    );
    return toToolDescriptors(rows);
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
          ...turnConcluded(),
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
          ...turnConcluded(),
        })
        .where(eq(schema.agentExecutions.id, input.executionId));
    });
  }

  async claimTurn(input: ClaimTurnInput): Promise<TurnClaim> {
    const ae = schema.agentExecutions;
    const token = randomUUID();
    return withWorkspace(input.workspaceId, async (tx) => {
      // Uma instrução só: cria em `claimed` ou retoma a linha liberada/abandonada. O índice
      // único parcial serializa entregas concorrentes; a segunda espera o commit da primeira
      // e reavalia o `setWhere` sobre a linha já gravada (READ COMMITTED).
      const [won] = await tx
        .insert(ae)
        .values({
          workspaceId: input.workspaceId,
          agentId: input.agentId,
          conversationId: input.conversationId,
          threadId: input.threadId,
          status: 'running',
          state: {},
          triggerId: input.triggerId,
          turnState: 'claimed',
          turnToken: token,
          turnAttempts: 1,
          turnClaimedAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: [ae.workspaceId, ae.triggerId],
          targetWhere: sql`${ae.triggerId} is not null`,
          set: {
            // O runtime nunca viu esta execução: o agente/conversa atuais valem.
            agentId: sql`excluded.agent_id`,
            conversationId: sql`excluded.conversation_id`,
            threadId: sql`excluded.thread_id`,
            status: 'running',
            error: null,
            completedAt: null,
            updatedAt: sql`now()`,
            turnState: 'claimed',
            turnToken: sql`excluded.turn_token`,
            turnAttempts: sql`coalesce(${ae.turnAttempts}, 0) + 1`,
            turnClaimedAt: sql`now()`,
          },
          setWhere: sql`${ae.turnState} = 'failed_before_runtime' or (${ae.turnState} = 'claimed' and ${ae.turnClaimedAt} < now() - ${input.leaseMs}::double precision * interval '1 millisecond')`,
        })
        .returning({ id: ae.id, attempts: ae.turnAttempts });
      if (won !== undefined) {
        return { kind: 'acquired', executionId: won.id, token, attempt: won.attempts ?? 1 };
      }

      const [current] = await tx
        .select({
          id: ae.id,
          agentId: ae.agentId,
          turnState: ae.turnState,
          turnReply: ae.turnReply,
        })
        .from(ae)
        .where(and(eq(ae.workspaceId, input.workspaceId), eq(ae.triggerId, input.triggerId)))
        .limit(1);
      if (current === undefined) return { kind: 'in_flight', executionId: null };
      switch (current.turnState) {
        case 'running':
          return { kind: 'running', executionId: current.id };
        case 'completed':
          return { kind: 'completed', executionId: current.id };
        case 'responded':
          return { kind: 'responded', executionId: current.id, reply: current.turnReply ?? '' };
        default:
          // `claimed` no lease (ou liberado entre as duas leituras): a fila retenta.
          return { kind: 'in_flight', executionId: current.id };
      }
    });
  }

  async markTurnRunning(input: TurnRef): Promise<boolean> {
    return this.transitionTurn(input, 'claimed', { turnState: 'running' });
  }

  async releaseTurn(input: TurnRef & { readonly error: string }): Promise<void> {
    await this.transitionTurn(input, 'claimed', {
      turnState: 'failed_before_runtime',
      status: 'failed',
      error: input.error,
      completedAt: new Date(),
    });
  }

  async saveTurnReply(input: TurnRef & { readonly reply: string }): Promise<boolean> {
    return this.transitionTurn(input, 'running', {
      turnState: 'responded',
      turnReply: input.reply,
    });
  }

  async deliverTurnReply(
    input: PersistAgentMessageInput & { readonly executionId: string },
  ): Promise<string | null> {
    const ae = schema.agentExecutions;
    return withWorkspace(input.workspaceId, async (tx) => {
      // Sem token de propósito: a entrega que retoma `responded` não é a dona original.
      // A transição condicional, na transação da mensagem, é o que garante UMA resposta.
      const [won] = await tx
        .update(ae)
        .set({ turnState: 'completed', turnReply: null, updatedAt: new Date() })
        .where(and(eq(ae.id, input.executionId), eq(ae.turnState, 'responded')))
        .returning({ id: ae.id });
      if (won === undefined) return null;
      return insertAgentMessage(tx, input);
    });
  }

  /** Transição de `turn_state` condicionada ao estado de origem E ao token do dono. */
  private async transitionTurn(
    input: TurnRef,
    from: 'claimed' | 'running',
    set: Partial<typeof schema.agentExecutions.$inferInsert>,
  ): Promise<boolean> {
    const ae = schema.agentExecutions;
    return withWorkspace(input.workspaceId, async (tx) => {
      const rows = await tx
        .update(ae)
        .set({ ...set, updatedAt: new Date() })
        .where(
          and(eq(ae.id, input.executionId), eq(ae.turnToken, input.token), eq(ae.turnState, from)),
        )
        .returning({ id: ae.id });
      return rows.length > 0;
    });
  }

  async persistAgentMessage(input: PersistAgentMessageInput): Promise<string> {
    return withWorkspace(input.workspaceId, (tx) => insertAgentMessage(tx, input));
  }
}

/**
 * Encerramento do turno junto com a execução (`completeExecution`/`failExecution`):
 * execução sem gatilho continua com `turn_state` NULL; com gatilho vira `completed`.
 */
function turnConcluded() {
  const { turnState } = schema.agentExecutions;
  return {
    turnState: sql<string | null>`case when ${turnState} is null then null else 'completed' end`,
    turnReply: null,
  } as const;
}

/**
 * Mensagem do agente (outbound, `pending`) + job de envio na outbox, na transação `tx`.
 */
async function insertAgentMessage(tx: DbTx, input: PersistAgentMessageInput): Promise<string> {
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
  // F70-S21: o job de envio (shape EXATO de `parseOutboundJob`, kind `text`) entra
  // na outbox NESTA transação. O relay publica depois do commit, com confirms.
  const job = {
    kind: 'text',
    channelId: input.channelId,
    conversationId: input.conversationId,
    messageId: row.id,
    chatId: input.chatId,
    text: input.content,
  };
  await enqueueOutbox(
    tx,
    queueJobOutbox(QUEUES.outbound, makeEnvelope(OUTBOUND_JOB_TYPE, input.workspaceId, job)),
  );
  return row.id;
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
