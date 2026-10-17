/**
 * Montagem do pedido ao runtime do Copiloto (`CopilotRunRequest`, COPILOTO.md §5.4).
 *
 * Tudo o que o modelo recebe é decidido aqui, no Node, sob o `tx` RLS do turno:
 * - histórico: as últimas 12 falas da sessão (para o assistente, o veredito);
 * - memória: perfil + fatos ativos; fato de integração vai marcado `untrusted` (dado de
 *   sistema de terceiro: o runtime aplica spotlighting);
 * - contexto de página: re-resolvido sob o escopo do membro (`context.ts`);
 * - ferramentas: só as que o membro pode usar ou pedir aprovação (`copilotToolDescriptorsFor`);
 * - política: modelo do workspace ou da plataforma e os limites duros do turno (R5).
 *
 * Nenhuma identidade vai ao runtime além do `grant` opaco (ADR-003).
 */
import { and, eq } from 'drizzle-orm';
import { estimateCostUsd, type ModelPricing } from '@hm/agents-core';
import { copilotMemoryRepo, copilotMessagesRepo, schema, type DbTx } from '@hm/db';
import {
  COPILOT_POLICY_LIMITS,
  CopilotRunRequestSchema,
  type CopilotPageContext,
  type CopilotPolicy,
  type CopilotRunRequest,
  type CopilotToolDescriptor,
} from '@hm/shared';
import { copilotToolDescriptorsFor } from '../../../internal/copilot';
import type { CopilotToolDefinition } from '../../../internal/copilot/core/registry';
import type { CopilotPrincipal } from '../identity/principal';
import { resolvePageContext, type ResolvedPageContext } from './context';

/** Modelo da plataforma quando o workspace não escolheu (mesmo padrão do runtime, F73-S04). */
export const COPILOT_PLATFORM_DEFAULT_MODEL = 'openai/gpt-4.1-mini';

/** Limites do turno (R5). Os tetos do contrato estão em `COPILOT_POLICY_LIMITS`. */
export const COPILOT_TURN_POLICY = {
  max_iterations: COPILOT_POLICY_LIMITS.max_iterations,
  max_tool_calls: COPILOT_POLICY_LIMITS.max_tool_calls,
  turn_timeout_s: COPILOT_POLICY_LIMITS.turn_timeout_s,
  /** Teto de completion por chamada ao modelo; também a base da estimativa do cost-guard. */
  max_tokens_per_call: 1024,
  temperature: 0.2,
} as const satisfies Omit<CopilotPolicy, 'model'>;

/** Tamanho fixo estimado do prompt de sistema do runtime, em tokens (formato fixo + regras). */
const SYSTEM_PROMPT_TOKENS_ESTIMATE = 2_000;
/** ~4 caracteres por token (mesma heurística do cost-guard dos agentes). */
const CHARS_PER_TOKEN = 4;

const HISTORY_CONTENT_MAX = 4000;
const FACT_SOURCE_LABEL_MAX = 200;

export function platformDefaultModel(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['COPILOT_DEFAULT_MODEL'];
  return configured !== undefined && configured.trim().length > 0
    ? configured.trim()
    : COPILOT_PLATFORM_DEFAULT_MODEL;
}

export interface TurnModel {
  readonly model: string;
  readonly pricing: ModelPricing;
}

function numericOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Modelo do turno e o preço por token (whitelist da plataforma). O modelo do workspace só
 * vale se estiver ATIVO na whitelist; senão cai no padrão da plataforma (nunca um modelo que
 * o super-admin tirou do ar). Preço desconhecido conta como 0 (semântica do cost-guard).
 */
export async function resolveTurnModel(
  tx: DbTx,
  workspaceModel: string | null,
  defaultModel: string,
): Promise<TurnModel> {
  const w = schema.llmModelsWhitelist;
  const lookup = async (slug: string) => {
    const [row] = await tx
      .select({ prompt: w.pricingPromptPer1m, completion: w.pricingCompletionPer1m })
      .from(w)
      .where(and(eq(w.slug, slug), eq(w.isActive, true)))
      .limit(1);
    return row ?? null;
  };
  if (workspaceModel) {
    const row = await lookup(workspaceModel);
    if (row) {
      return {
        model: workspaceModel,
        pricing: {
          promptPer1m: numericOrNull(row.prompt),
          completionPer1m: numericOrNull(row.completion),
        },
      };
    }
  }
  const row = await lookup(defaultModel);
  return {
    model: defaultModel,
    pricing: {
      promptPer1m: row ? numericOrNull(row.prompt) : null,
      completionPer1m: row ? numericOrNull(row.completion) : null,
    },
  };
}

/** Custo de um uso real, quando o provedor não informou (`total_cost_usd: null`). */
export function costFromUsage(
  usage: { readonly prompt_tokens: number; readonly completion_tokens: number },
  pricing: ModelPricing,
): number {
  return estimateCostUsd(
    { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens },
    pricing,
  );
}

export interface TurnInputs {
  readonly history: CopilotRunRequest['history'];
  readonly memory: CopilotRunRequest['memory'];
  readonly context: ResolvedPageContext;
  readonly tools: CopilotToolDescriptor[];
}

/**
 * Lê histórico, memória e contexto e filtra as ferramentas. Chamar ANTES de gravar a
 * pergunta deste turno: o histórico é o que veio antes dela.
 */
export async function loadTurnInputs(
  tx: DbTx,
  input: {
    readonly principal: CopilotPrincipal;
    readonly sessionId: string;
    readonly pageContext: CopilotPageContext | undefined;
    readonly tools: readonly CopilotToolDefinition[];
  },
): Promise<TurnInputs> {
  const rows = await copilotMessagesRepo.lastForPrompt(
    tx,
    input.sessionId,
    COPILOT_POLICY_LIMITS.history_max,
  );
  const history: CopilotRunRequest['history'] = [];
  for (const row of rows) {
    if (row.role !== 'user' && row.role !== 'assistant') continue;
    const content = row.content.slice(0, HISTORY_CONTENT_MAX);
    if (content.trim().length === 0) continue;
    history.push({ role: row.role, content });
  }

  const raw = await copilotMemoryRepo.listActiveForPrompt(tx, input.principal.workspaceId);
  const memory: CopilotRunRequest['memory'] = {
    profile: raw.profile.map((p) => ({ key: p.key, content: p.content })),
    facts: raw.facts.slice(0, COPILOT_POLICY_LIMITS.memory_facts_max).map((f) => ({
      id: f.id,
      content: f.content,
      source_label: f.sourceLabel.slice(0, FACT_SOURCE_LABEL_MAX),
      ...(f.sourceType === 'integration' ? { untrusted: true } : {}),
    })),
  };

  const context = await resolvePageContext(tx, input.principal, input.pageContext);
  const tools = await copilotToolDescriptorsFor(tx, input.principal, input.tools);
  return { history, memory, context, tools };
}

/**
 * Estimativa CONSERVADORA (limite superior) do custo do turno, para a guarda de orçamento
 * antes de chamar o runtime: cada iteração reenvia o prompt inteiro e pode gastar o teto de
 * completion. Preço desconhecido = 0 (o real é reconciliado no `final`).
 */
export function estimateTurnCostUsd(
  inputs: TurnInputs,
  userInput: string,
  pricing: ModelPricing,
): number {
  const chars =
    userInput.length +
    inputs.history.reduce((n, h) => n + h.content.length, 0) +
    inputs.memory.profile.reduce((n, p) => n + p.content.length, 0) +
    inputs.memory.facts.reduce((n, f) => n + f.content.length + f.source_label.length, 0) +
    (inputs.context.entitySummary?.length ?? 0) +
    JSON.stringify(inputs.tools).length;
  const promptPerIteration = SYSTEM_PROMPT_TOKENS_ESTIMATE + Math.ceil(chars / CHARS_PER_TOKEN);
  const iterations = COPILOT_TURN_POLICY.max_iterations;
  return estimateCostUsd(
    {
      promptTokens: promptPerIteration * iterations,
      completionTokens: COPILOT_TURN_POLICY.max_tokens_per_call * iterations,
    },
    pricing,
  );
}

export interface BuildRunRequestInput {
  readonly turnId: string;
  readonly workspaceId: string;
  readonly grant: string;
  readonly member: CopilotRunRequest['member'];
  readonly now: Date;
  readonly inputs: TurnInputs;
  readonly model: string;
  readonly userInput: string;
}

/** Monta e VALIDA o pedido (o mesmo Zod que o runtime espelha). Inválido = bug: lança. */
export function buildRunRequest(input: BuildRunRequestInput): CopilotRunRequest {
  const { context } = input.inputs;
  return CopilotRunRequestSchema.parse({
    turn_id: input.turnId,
    workspace_id: input.workspaceId,
    grant: input.grant,
    member: input.member,
    now_iso: input.now.toISOString(),
    page_context_resolved: {
      label: context.label,
      ...(context.entitySummary !== undefined ? { entity_summary: context.entitySummary } : {}),
    },
    history: input.inputs.history,
    memory: input.inputs.memory,
    tools: input.inputs.tools,
    policy: { model: input.model, ...COPILOT_TURN_POLICY },
    user_input: input.userInput,
  });
}
