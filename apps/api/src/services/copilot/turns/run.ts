/**
 * Turno do Copiloto em produção (F73-S10; COPILOTO.md §3, §5.3, §5.4; P8; R5; ADR-003).
 *
 *   1. limite de taxa por membro (6/min, 300/dia; Redis)               → `error rate_limited`
 *   2. um turno `running` por membro (lock consultivo por membro)       → `error turn_in_progress`
 *      reenvio com o MESMO `client_request_id`                          → 409 + `turn_id`
 *   3. guarda de orçamento ANTES do turno: estado do mês + estimativa
 *      conservadora (cost-guard) do turno                               → `budget_exceeded`
 *   4. `createRunning` (idempotente por `client_request_id`) + pergunta gravada
 *   5. `mintGrant`
 *   6. runtime: eventos internos → contrato público (`map-events.ts`)
 *   7. fim, numa transação: resposta do assistente, `complete(usage)` e `llm_usage_logs`
 *      com `surface='copilot'`, `copilot_turn_id` e o custo do `final`
 *   8. desconexão ou "parar": aborta o runtime e grava `cancelled` (a pergunta e o que já
 *      chegou ficam gravados)
 *
 * Passos 2–4 rodam numa transação só, serializada por membro com
 * `pg_advisory_xact_lock`: duas abas mandando ao mesmo tempo nunca abrem dois turnos.
 *
 * A pergunta é gravada no INÍCIO (mesma transação do turno), e não no fim: o `turn_started`
 * carrega o `message_id` dela, e uma queda do processo no meio do turno não perde o que a
 * pessoa perguntou. A resposta, o encerramento do turno e o custo vão juntos no fim.
 *
 * Erros só saem como frame `error { code, ref }`: o `ref` (`hm_err_*`) correlaciona com o
 * log, que tem o detalhe (tipo do erro, código do runtime). Texto do runtime ou do modelo
 * nunca sai em erro. Uma linha de métrica por turno no log, sem conteúdo.
 */
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import {
  AgentRuntimeError,
  createCopilotRuntimeClient,
  type CopilotRuntimeClient,
} from '@hm/agents-client';
import { copilotBudgetState } from '@hm/agents-core';
import {
  copilotMessagesRepo,
  copilotSessionsRepo,
  copilotTurnsRepo,
  schema,
  type CopilotJsonObject,
  type CopilotSessionRow,
  type CopilotTurnRow,
  type DbTx,
} from '@hm/db';
import type { Logger } from '@hm/logger';
import {
  COPILOT_STREAM_VERSION,
  type AskInput,
  type CopilotErrorCode,
  type CopilotRunRequest,
} from '@hm/shared';
import type { CopilotToolDefinition } from '../../../internal/copilot/core/registry';
import {
  copilotRanStatus,
  recordCopilotCost,
  recordCopilotRejection,
  recordCopilotRuntimeUnavailable,
  recordCopilotTtfb,
  recordCopilotTurn,
} from '../../../observability/copilot-metrics';
import { budgetResetsOn, monthToDateCopilotSpendUsd } from '../identity/budget';
import { COPILOT_GRANT_TTL_SECONDS, generateGrantNonce, mintGrant } from '../identity/grant';
import type { CopilotPrincipal } from '../identity/principal';
import {
  COPILOT_TURN_POLICY,
  buildRunRequest,
  costFromUsage,
  estimateTurnCostUsd,
  loadTurnInputs,
  resolveTurnModel,
  type TurnInputs,
  type TurnModel,
} from './assemble';
import { createEventMapper, type MappedStep, type TurnAccumulator } from './map-events';
import type { CopilotRateLimiter } from './rate-limit';
import { openCopilotSse, type CopilotSseWriter } from './sse';
import { sessionTitleFrom } from './title';

/** Folga do Node acima do `turn_timeout_s` do runtime antes de abortar por conta própria. */
export const COPILOT_DEADLINE_GRACE_MS = 10_000;
/** Teto padrão do turno no Node: o do runtime + a folga. */
export const COPILOT_TURN_DEADLINE_MS =
  COPILOT_TURN_POLICY.turn_timeout_s * 1000 + COPILOT_DEADLINE_GRACE_MS;
const MESSAGE_CONTENT_MAX = 4000;

export interface CopilotTurnDeps {
  /** Cliente do runtime; `null` = não configurado (vira `runtime_unavailable`). */
  readonly runtime: () => CopilotRuntimeClient | null;
  readonly rateLimiter: CopilotRateLimiter;
  /** Registro de ferramentas (descritores e rótulos de `status`). */
  readonly tools: readonly CopilotToolDefinition[];
  readonly logger: Logger;
  readonly now: () => Date;
  readonly heartbeatMs: number;
  readonly defaultModel: string;
  /**
   * Teto de tempo do turno no NODE, acima do `turn_timeout_s` do runtime (defesa em
   * profundidade, R5): vencido, o runtime é abortado e o turno vira `timeout`.
   */
  readonly deadlineMs: number;
  /** Segredo do grant (testes). Default: `COPILOT_GRANT_SECRET`. */
  readonly grantSecret?: Buffer;
}

/** Cliente do runtime a partir de `AGENT_RUNTIME_URL`/`AGENT_RUNTIME_TOKEN`; `null` sem eles. */
export function runtimeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): () => CopilotRuntimeClient | null {
  let client: CopilotRuntimeClient | null = null;
  return () => {
    if (client) return client;
    const baseUrl = env['AGENT_RUNTIME_URL'];
    const token = env['AGENT_RUNTIME_TOKEN'];
    if (!baseUrl || !token) return null;
    client = createCopilotRuntimeClient({ baseUrl, token });
    return client;
  };
}

// ─── Turnos ativos neste processo (para o "Parar") ───────────────────────────────

type AbortReason = 'client_disconnected' | 'cancelled_by_user' | 'timeout';

const ACTIVE_TURNS = new Map<
  string,
  { readonly memberId: string; readonly abort: (r: AbortReason) => void }
>();

/**
 * Aborta o turno vivo NESTE processo (o "Parar"). O estado `cancelled` no banco é gravado
 * pelo chamador; ele também vale entre processos, porque o callback das ferramentas recusa
 * turno que não está `running`.
 */
export function abortActiveTurn(turnId: string, memberId: string): boolean {
  const active = ACTIVE_TURNS.get(turnId);
  if (!active || active.memberId !== memberId) return false;
  active.abort('cancelled_by_user');
  return true;
}

/** Cancela um turno do membro (dono). `null` = não existe ou é de outro membro. */
export async function cancelTurn(
  scoped: <T>(fn: (tx: DbTx) => Promise<T>) => Promise<T>,
  input: { readonly turnId: string; readonly memberId: string },
): Promise<{ readonly turnId: string; readonly status: CopilotTurnRow['status'] } | null> {
  const result = await scoped(async (tx) => {
    const t = schema.copilotTurns;
    const [row] = await tx
      .select({ id: t.id, status: t.status })
      .from(t)
      .where(and(eq(t.id, input.turnId), eq(t.memberId, input.memberId)))
      .limit(1);
    if (!row) return null;
    if (row.status !== 'running') return { turnId: row.id, status: row.status };
    const failed = await copilotTurnsRepo.fail(tx, row.id, {
      status: 'cancelled',
      errorCode: 'cancelled_by_user',
    });
    return { turnId: row.id, status: failed?.status ?? row.status };
  });
  if (result) abortActiveTurn(input.turnId, input.memberId);
  return result;
}

// ─── Pedido ─────────────────────────────────────────────────────────────────────

export interface AskContext {
  readonly req: Request;
  readonly res: Response;
  readonly scoped: <T>(fn: (tx: DbTx) => Promise<T>) => Promise<T>;
  readonly principal: CopilotPrincipal;
  readonly member: CopilotRunRequest['member'];
  readonly session: CopilotSessionRow;
  readonly body: AskInput;
}

type Preparation =
  | { readonly kind: 'replay'; readonly turnId: string }
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'budget' }
  | {
      readonly kind: 'ready';
      readonly turn: CopilotTurnRow;
      readonly nonce: string;
      readonly userMessageId: string;
      readonly inputs: TurnInputs;
      readonly turnModel: TurnModel;
      readonly budgetState: string;
    };

type Outcome =
  | { readonly kind: 'final'; readonly step: Extract<MappedStep, { kind: 'final' }> }
  | {
      readonly kind: 'runtime_error';
      readonly code: CopilotErrorCode;
      readonly runtimeCode: string;
    }
  | { readonly kind: 'aborted'; readonly reason: AbortReason }
  | { readonly kind: 'failure'; readonly code: CopilotErrorCode; readonly detail: string };

function newRef(): string {
  return `hm_err_${randomUUID().slice(0, 8)}`;
}

function memberLockKey(memberId: string): string {
  return `copilot_turn:${memberId}`;
}

/** Abre o SSE só para um frame de recusa e fecha. */
function rejectWithFrame(
  res: Response,
  deps: CopilotTurnDeps,
  frame:
    | { readonly code: CopilotErrorCode }
    | { readonly budget: { mode: 'queries_only' | 'pause'; resetsOn: string } },
  fields: Record<string, unknown>,
): void {
  const sse = openCopilotSse(res, { heartbeatMs: deps.heartbeatMs });
  if ('code' in frame) {
    const ref = newRef();
    sse.send({ v: COPILOT_STREAM_VERSION, type: 'error', code: frame.code, ref });
    deps.logger.warn('copilot.turn_rejected', { ...fields, reason: frame.code, ref });
    recordCopilotRejection(frame.code);
  } else {
    sse.send({
      v: COPILOT_STREAM_VERSION,
      type: 'budget_exceeded',
      mode: frame.budget.mode,
      resets_on: frame.budget.resetsOn,
    });
    deps.logger.warn('copilot.turn_rejected', { ...fields, reason: 'budget_exceeded' });
    recordCopilotRejection('budget_exceeded');
  }
  sse.end();
}

export async function handleAsk(ctx: AskContext, deps: CopilotTurnDeps): Promise<void> {
  const { res, principal, session, body } = ctx;
  const t0 = performance.now();
  const now = deps.now();
  const ws = principal.workspaceId;
  const memberId = principal.memberId;
  const baseFields = {
    workspace_id: ws,
    member_id: memberId,
    session_id: session.id,
    origin: body.origin,
  };

  let clientGone = false;
  const onEarlyClose = (): void => {
    clientGone = true;
  };
  res.on('close', onEarlyClose);

  const runtime = deps.runtime();
  if (!runtime) {
    rejectWithFrame(
      res,
      deps,
      { code: 'runtime_unavailable' },
      { ...baseFields, detail: 'runtime_not_configured' },
    );
    return;
  }

  // 1. Limite de taxa.
  const rate = await deps.rateLimiter.consume(memberId, now);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSec));
    rejectWithFrame(res, deps, { code: 'rate_limited' }, { ...baseFields, window: rate.window });
    return;
  }

  // 2–4. Um turno por membro, orçamento, turno e pergunta: uma transação, serializada por membro.
  const settings = principal.settings;
  const prep: Preparation = await ctx.scoped(async (tx): Promise<Preparation> => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${memberLockKey(memberId)}, 0))`,
    );
    const running = await copilotTurnsRepo.findRunningByMember(tx, memberId);
    if (running) {
      if (running.clientRequestId === body.client_request_id)
        return { kind: 'replay', turnId: running.id };
      if (running.expiresAt.getTime() > now.getTime()) return { kind: 'in_progress' };
      // Turno órfão (processo caiu): passou da validade do grant, encerra e segue.
      await copilotTurnsRepo.fail(tx, running.id, { errorCode: 'expired', status: 'failed' });
    }

    const turnModel = await resolveTurnModel(tx, settings.model, deps.defaultModel);
    const inputs = await loadTurnInputs(tx, {
      principal,
      sessionId: session.id,
      pageContext: body.page_context,
      tools: deps.tools,
    });
    const spend = await monthToDateCopilotSpendUsd(tx, ws, now);
    const state = copilotBudgetState(settings, spend);
    const estimate = estimateTurnCostUsd(inputs, body.text, turnModel.pricing);
    if (state === 'paused' || copilotBudgetState(settings, spend + estimate) === 'paused') {
      return { kind: 'budget' };
    }

    const nonce = generateGrantNonce();
    const { turn, created } = await copilotTurnsRepo.createRunning(tx, {
      workspaceId: ws,
      memberId,
      sessionId: session.id,
      grantNonce: nonce,
      expiresAt: new Date(now.getTime() + COPILOT_GRANT_TTL_SECONDS * 1000),
      maxToolCalls: COPILOT_TURN_POLICY.max_tool_calls,
      model: turnModel.model,
      clientRequestId: body.client_request_id,
    });
    if (!created) return { kind: 'replay', turnId: turn.id };

    if (!session.title) {
      await copilotSessionsRepo.rename(tx, session.id, memberId, sessionTitleFrom(body.text));
    }
    const userMessage = await copilotMessagesRepo.append(tx, {
      workspaceId: ws,
      sessionId: session.id,
      role: 'user',
      content: body.text,
      turnId: turn.id,
      pageContext: inputs.context.stored,
    });
    await copilotSessionsRepo.touch(
      tx,
      session.id,
      body.page_context ? { lastPageContext: inputs.context.stored } : {},
    );
    return {
      kind: 'ready',
      turn,
      nonce,
      userMessageId: userMessage.id,
      inputs,
      turnModel,
      budgetState: state,
    };
  });

  if (prep.kind === 'replay') {
    res.status(409).json({
      error: 'duplicate_request',
      message: 'Este pedido já foi recebido.',
      turn_id: prep.turnId,
    });
    return;
  }
  if (prep.kind === 'in_progress') {
    rejectWithFrame(res, deps, { code: 'turn_in_progress' }, baseFields);
    return;
  }
  if (prep.kind === 'budget') {
    rejectWithFrame(
      res,
      deps,
      { budget: { mode: settings.budgetMode, resetsOn: budgetResetsOn(now) } },
      baseFields,
    );
    return;
  }

  await runTurn(ctx, deps, prep, runtime, { t0, baseFields, earlyGone: () => clientGone });
  res.off('close', onEarlyClose);
}

async function runTurn(
  ctx: AskContext,
  deps: CopilotTurnDeps,
  prep: Extract<Preparation, { kind: 'ready' }>,
  runtime: CopilotRuntimeClient,
  meta: {
    readonly t0: number;
    readonly baseFields: Record<string, unknown>;
    readonly earlyGone: () => boolean;
  },
): Promise<void> {
  const { res, principal, session, body } = ctx;
  const { turn, inputs, turnModel } = prep;
  const ws = principal.workspaceId;
  const memberId = principal.memberId;
  const ref = newRef();
  const fields = { ...meta.baseFields, turn_id: turn.id, ref };

  // 5. Grant + pedido. Falha aqui é bug nosso: turno encerrado e erro seguro.
  let runRequest: CopilotRunRequest;
  try {
    const grant = mintGrant(
      { turnId: turn.id, workspaceId: ws, memberId, nonce: prep.nonce },
      deps.grantSecret ? { secret: deps.grantSecret } : {},
    );
    runRequest = buildRunRequest({
      turnId: turn.id,
      workspaceId: ws,
      grant,
      member: ctx.member,
      now: deps.now(),
      inputs,
      model: turnModel.model,
      userInput: body.text,
    });
  } catch (err: unknown) {
    deps.logger.error('copilot.turn_assemble_failed', {
      ...fields,
      error: err instanceof Error ? err.name : 'unknown',
    });
    await ctx
      .scoped((tx) => copilotTurnsRepo.fail(tx, turn.id, { errorCode: 'internal' }))
      .catch(() => null);
    rejectWithFrame(res, deps, { code: 'internal' }, fields);
    return;
  }

  const sse: CopilotSseWriter = openCopilotSse(res, {
    heartbeatMs: deps.heartbeatMs,
    onInvalidFrame: (type) => deps.logger.error('copilot.frame_invalid', { ...fields, type }),
  });
  sse.send({
    v: COPILOT_STREAM_VERSION,
    type: 'turn_started',
    turn_id: turn.id,
    session_id: session.id,
    message_id: prep.userMessageId,
    context_label: inputs.context.chipLabel,
  });
  const ttfbMs = Math.round(performance.now() - meta.t0);
  recordCopilotTtfb(ttfbMs / 1000);

  // 6. Runtime, com abort por desconexão, "Parar" e teto de tempo do próprio Node.
  const controller = new AbortController();
  let abortReason: AbortReason | null = null;
  const abort = (reason: AbortReason): void => {
    if (abortReason !== null) return;
    abortReason = reason;
    controller.abort();
  };
  let streaming = true;
  const onClose = (): void => {
    if (streaming) abort('client_disconnected');
  };
  res.on('close', onClose);
  if (meta.earlyGone()) abort('client_disconnected');
  ACTIVE_TURNS.set(turn.id, { memberId, abort });
  const deadline = setTimeout(() => abort('timeout'), deps.deadlineMs);
  deadline.unref();

  const mapper = createEventMapper(deps.tools);
  let outcome: Outcome | null = null;
  try {
    for await (const event of runtime.runCopilot(runRequest, { signal: controller.signal })) {
      const step = mapper.map(event);
      if (step.kind === 'emit') sse.send(step.event);
      else if (step.kind === 'final') {
        outcome = { kind: 'final', step };
        break;
      } else if (step.kind === 'error') {
        outcome = { kind: 'runtime_error', code: step.code, runtimeCode: step.runtimeCode };
        break;
      }
    }
    outcome ??= { kind: 'failure', code: 'internal', detail: 'no_terminal' };
  } catch (err: unknown) {
    if (abortReason !== null) outcome = { kind: 'aborted', reason: abortReason };
    else if (err instanceof AgentRuntimeError) {
      outcome = {
        kind: 'failure',
        code: err.kind === 'network' || err.kind === 'http' ? 'runtime_unavailable' : 'internal',
        detail: err.kind === 'http' ? `http_${err.httpStatus}` : err.kind,
      };
    } else {
      outcome = {
        kind: 'failure',
        code: 'internal',
        detail: err instanceof Error ? err.name : 'unknown',
      };
    }
  } finally {
    streaming = false;
    clearTimeout(deadline);
    ACTIVE_TURNS.delete(turn.id);
    res.off('close', onClose);
  }
  // Abort que chegou entre o último evento e a saída do laço sem terminal.
  if (outcome.kind === 'failure' && abortReason !== null)
    outcome = { kind: 'aborted', reason: abortReason };

  // 7–8. Fecha o turno.
  const finished = await finishTurn(ctx, deps, prep, mapper.state, outcome, sse, ref).catch(
    (err: unknown) => {
      deps.logger.error('copilot.turn_persist_failed', {
        ...fields,
        error: err instanceof Error ? err.name : 'unknown',
      });
      return {
        errorCode: 'internal',
        costUsd: 0,
        iterations: 0,
        promptTokens: 0,
        completionTokens: 0,
        failedPersist: true,
      };
    },
  );
  if ('failedPersist' in finished) {
    await ctx
      .scoped((tx) => copilotTurnsRepo.fail(tx, turn.id, { errorCode: 'internal' }))
      .catch(() => null);
    sse.send({ v: COPILOT_STREAM_VERSION, type: 'error', code: 'internal', ref });
  }
  sse.end();

  // Métrica do turno: números e códigos, nunca conteúdo.
  const final = await ctx
    .scoped(async (tx) => {
      const [row] = await tx
        .select({
          status: schema.copilotTurns.status,
          toolCalls: schema.copilotTurns.toolCalls,
          tainted: schema.copilotTurns.tainted,
        })
        .from(schema.copilotTurns)
        .where(eq(schema.copilotTurns.id, turn.id))
        .limit(1);
      return row ?? null;
    })
    .catch(() => null);
  recordCopilotTurn(copilotRanStatus(final?.status), (performance.now() - meta.t0) / 1000);
  recordCopilotCost(finished.costUsd);
  if (
    (outcome.kind === 'failure' || outcome.kind === 'runtime_error') &&
    outcome.code === 'runtime_unavailable'
  ) {
    recordCopilotRuntimeUnavailable();
  }
  deps.logger.info('copilot.turn', {
    ...fields,
    outcome: outcome.kind === 'aborted' ? outcome.reason : outcome.kind,
    status: final?.status ?? null,
    error_code: finished.errorCode,
    duration_ms: Math.round(performance.now() - meta.t0),
    ttfb_ms: ttfbMs,
    iterations: finished.iterations,
    tool_calls: final?.toolCalls ?? null,
    tainted: final?.tainted ?? null,
    cost_usd: finished.costUsd,
    prompt_tokens: finished.promptTokens,
    completion_tokens: finished.completionTokens,
    model: turnModel.model,
    budget_state: prep.budgetState,
    events: mapper.state.emitted,
    cards: mapper.state.cards.length,
    iteration_exceeded: mapper.state.iterationExceeded,
    ...(outcome.kind === 'runtime_error' ? { runtime_code: outcome.runtimeCode } : {}),
    ...(outcome.kind === 'failure' ? { detail: outcome.detail } : {}),
  });
}

interface FinishResult {
  readonly errorCode: string | null;
  readonly costUsd: number;
  readonly iterations: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/** Proposta citada que existe DE FATO neste workspace (a FK da mensagem exige). */
async function existingProposalId(tx: DbTx, ids: readonly string[]): Promise<string | null> {
  for (const id of [...ids].reverse()) {
    const p = schema.copilotActionProposals;
    const [row] = await tx.select({ id: p.id }).from(p).where(eq(p.id, id)).limit(1);
    if (row) return row.id;
  }
  return null;
}

function cardsJson(state: TurnAccumulator): CopilotJsonObject[] | null {
  return state.cards.length > 0 ? state.cards.map((c) => ({ ...c })) : null;
}

async function finishTurn(
  ctx: AskContext,
  deps: CopilotTurnDeps,
  prep: Extract<Preparation, { kind: 'ready' }>,
  state: TurnAccumulator,
  outcome: Outcome,
  sse: CopilotSseWriter,
  ref: string,
): Promise<FinishResult> {
  const { principal, session } = ctx;
  const { turn, turnModel } = prep;
  const ws = principal.workspaceId;
  const empty = { costUsd: 0, iterations: 0, promptTokens: 0, completionTokens: 0 };

  if (outcome.kind === 'final') {
    const { final, blocks } = outcome.step;
    const cost = final.usage.total_cost_usd ?? costFromUsage(final.usage, turnModel.pricing);
    const costUsd = Number.isFinite(cost) && cost > 0 ? cost : 0;
    const latencyMs = Math.max(0, Date.now() - turn.startedAt.getTime());
    const messageId = await ctx.scoped(async (tx) => {
      const proposalId = await existingProposalId(tx, state.proposalIds);
      const assistant = await copilotMessagesRepo.append(tx, {
        workspaceId: ws,
        sessionId: session.id,
        role: 'assistant',
        content: (blocks.verdict || state.verdict).slice(0, MESSAGE_CONTENT_MAX),
        turnId: turn.id,
        blocks: { ...blocks },
        toolResults: cardsJson(state),
        proposalId,
      });
      await copilotTurnsRepo.complete(tx, turn.id, {
        model: turnModel.model,
        promptTokens: final.usage.prompt_tokens,
        completionTokens: final.usage.completion_tokens,
        costUsd: costUsd.toFixed(8),
        iterations: final.iterations,
      });
      await tx.insert(schema.llmUsageLogs).values({
        workspaceId: ws,
        requestType: 'chat',
        router: 'openrouter',
        model: turnModel.model,
        promptTokens: final.usage.prompt_tokens,
        completionTokens: final.usage.completion_tokens,
        totalTokens: final.usage.prompt_tokens + final.usage.completion_tokens,
        costUsd: costUsd.toFixed(8),
        latencyMs,
        surface: 'copilot',
        copilotTurnId: turn.id,
        metadata: {
          iterations: final.iterations,
          cost_source: final.usage.total_cost_usd === null ? 'whitelist_pricing' : 'provider',
          ...(final.format_fallback ? { format_fallback: true } : {}),
          ...(state.iterationExceeded ? { iteration_exceeded: true } : {}),
        },
      });
      await copilotSessionsRepo.touch(tx, session.id);
      return assistant.id;
    });
    sse.send({ v: COPILOT_STREAM_VERSION, type: 'final', message_id: messageId, blocks });
    return {
      errorCode: null,
      costUsd,
      iterations: final.iterations,
      promptTokens: final.usage.prompt_tokens,
      completionTokens: final.usage.completion_tokens,
    };
  }

  if (outcome.kind === 'aborted' && outcome.reason !== 'timeout') {
    // Desconexão ou "Parar": a pergunta já está gravada; grava o que chegou.
    await ctx.scoped(async (tx) => {
      await copilotTurnsRepo.fail(tx, turn.id, { status: 'cancelled', errorCode: outcome.reason });
      const cards = cardsJson(state);
      if (state.verdict.length > 0 || cards) {
        await copilotMessagesRepo.append(tx, {
          workspaceId: ws,
          sessionId: session.id,
          role: 'assistant',
          content: state.verdict.slice(0, MESSAGE_CONTENT_MAX),
          turnId: turn.id,
          toolResults: cards,
          proposalId: await existingProposalId(tx, state.proposalIds),
        });
      }
    });
    return { errorCode: outcome.reason, ...empty };
  }

  const code: CopilotErrorCode = outcome.kind === 'aborted' ? 'timeout' : outcome.code;
  const errorCode = outcome.kind === 'runtime_error' ? outcome.runtimeCode : code;
  await ctx.scoped((tx) => copilotTurnsRepo.fail(tx, turn.id, { errorCode }));
  sse.send({ v: COPILOT_STREAM_VERSION, type: 'error', code, ref });
  deps.logger.warn('copilot.turn_failed', {
    workspace_id: ws,
    turn_id: turn.id,
    ref,
    code,
    ...(outcome.kind === 'runtime_error' ? { runtime_code: outcome.runtimeCode } : {}),
    ...(outcome.kind === 'failure' ? { detail: outcome.detail } : {}),
  });
  return { errorCode, ...empty };
}
