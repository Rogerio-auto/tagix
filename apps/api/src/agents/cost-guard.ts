/**
 * Hard cap de custo de agente — pré-chamada, no Node (F2-S09,
 * AGENTS_LANGGRAPH §8.1, ROADMAP F2-S09).
 *
 * Barreira que decide, ANTES de despachar uma execução ao `agent-runtime`, se o
 * workspace ainda tem orçamento mensal para a chamada estimada. A regra
 * (AGENTS_LANGGRAPH §8.1):
 *
 *   policy.max_monthly_cost_usd − sum(llm_usage_logs do mês) > custo_estimado
 *
 * Se o cap mensal seria estourado, a execução é **bloqueada** (não chama o
 * runtime) e o motivo é devolvido para o caller registrar e emitir o evento
 * `budget_exceeded` (§10.2). A estimativa de custo é **conservadora** (limite
 * superior) — por design, é melhor bloquear de leve a mais do que estourar o cap
 * do workspace (vide nota do slot).
 *
 * **Consumo:**
 *  - F2-S11 (worker dispatch) chama `assertWithinBudget` com o `ResolvedPolicy`
 *    de `resolvePolicy` (mesmo slot) e o custo estimado do turno; em `blocked`
 *    aborta o dispatch e propaga o motivo.
 *  - O custo estimado vem de tokens previstos + pricing do modelo
 *    (`estimateCostUsd`), com `policy.max_tokens_per_call` como teto de
 *    completion quando o caller não tem estimativa melhor.
 *
 * Este módulo é **puro** (sem I/O): recebe a policy + gasto já resolvidos e o
 * custo estimado, e devolve a decisão. A leitura do gasto sob RLS vive em
 * `policy-resolver` (`monthToDateSpendUsd`), o que mantém o guard testável sem
 * banco e reutilizável entre dispatch real e playground.
 */
import type { ResolvedPolicy, WorkspacePolicy } from './policy-resolver';

/** Pricing de um modelo em USD por 1M tokens (snapshot de `llm_models_whitelist`). */
export interface ModelPricing {
  /** USD por 1M prompt tokens. `null` = desconhecido (trata como 0 — não inflar). */
  readonly promptPer1m: number | null;
  /** USD por 1M completion tokens. `null` = desconhecido. */
  readonly completionPer1m: number | null;
}

/** Tokens previstos para a chamada estimada. */
export interface EstimatedUsage {
  readonly promptTokens: number;
  /**
   * Completion tokens previstos. Quando o caller não tem uma estimativa, usar o
   * teto da policy (`max_tokens_per_call`) é o limite superior conservador.
   */
  readonly completionTokens: number;
}

/**
 * Estima (limite superior) o custo em USD de uma chamada LLM a partir dos tokens
 * previstos e do pricing do modelo. Pricing ausente conta como 0 para aquele
 * eixo — nunca inflaciona artificialmente (o cap não deve bloquear por falta de
 * dado de pricing; o custo real é reconciliado depois em `llm_usage_logs`).
 */
export function estimateCostUsd(usage: EstimatedUsage, pricing: ModelPricing): number {
  const prompt = (usage.promptTokens / 1_000_000) * (pricing.promptPer1m ?? 0);
  const completion = (usage.completionTokens / 1_000_000) * (pricing.completionPer1m ?? 0);
  return prompt + completion;
}

/** Decisão do guard. `headroomUsd` = orçamento restante antes desta chamada. */
export type BudgetDecision =
  | {
      readonly ok: true;
      /** Orçamento restante (`cap − gasto`); `null` = sem cap. */
      readonly headroomUsd: number | null;
      readonly estimatedCostUsd: number;
    }
  | {
      readonly ok: false;
      readonly reason: 'monthly_budget_exceeded';
      /** Cap mensal configurado (USD). */
      readonly capUsd: number;
      /** Gasto acumulado do mês (USD). */
      readonly spentUsd: number;
      /** Orçamento restante antes desta chamada (`cap − gasto`, nunca negativo). */
      readonly headroomUsd: number;
      readonly estimatedCostUsd: number;
      /** Mensagem pronta para log/observabilidade. */
      readonly message: string;
    };

/** Entrada de `assertWithinBudget`. */
export interface AssertWithinBudgetInput {
  readonly workspaceId: string;
  readonly policy: WorkspacePolicy;
  /** Gasto acumulado do mês corrente (de `monthToDateSpendUsd`). */
  readonly monthToDateSpendUsd: number;
  /** Custo estimado (conservador) da chamada prestes a ser despachada. */
  readonly estimatedCostUsd: number;
}

/**
 * Decide se a chamada estimada cabe no orçamento mensal do workspace.
 *
 * Sem cap (`max_monthly_cost_usd IS NULL`) → sempre `ok` com `headroomUsd: null`.
 *
 * Com cap, bloqueia quando `gasto + estimado > cap`, i.e. quando o headroom
 * (`cap − gasto`) é **menor** que o custo estimado. Um workspace já no cap
 * (`headroom = 0`) bloqueia qualquer chamada de custo positivo; uma chamada de
 * custo estimado 0 (pricing desconhecido) é permitida mesmo no cap (não há como
 * estourar com custo 0 — o real é reconciliado depois).
 *
 * Estimativa negativa é tratada como 0 (entrada defensiva).
 */
export function assertWithinBudget(input: AssertWithinBudgetInput): BudgetDecision {
  const cap = input.policy.maxMonthlyCostUsd;
  const estimated = Math.max(input.estimatedCostUsd, 0);

  if (cap === null) {
    return { ok: true, headroomUsd: null, estimatedCostUsd: estimated };
  }

  const spent = Math.max(input.monthToDateSpendUsd, 0);
  const headroom = Math.max(cap - spent, 0);

  // Bloqueia se a chamada estimada estouraria o cap. Custo 0 nunca estoura.
  if (estimated > 0 && spent + estimated > cap) {
    return {
      ok: false,
      reason: 'monthly_budget_exceeded',
      capUsd: cap,
      spentUsd: spent,
      headroomUsd: headroom,
      estimatedCostUsd: estimated,
      message:
        `Cap mensal de custo de IA atingido para o workspace ${input.workspaceId}: ` +
        `gasto ${spent.toFixed(4)} USD + estimado ${estimated.toFixed(4)} USD > ` +
        `cap ${cap.toFixed(2)} USD (headroom ${headroom.toFixed(4)} USD).`,
    };
  }

  return { ok: true, headroomUsd: headroom, estimatedCostUsd: estimated };
}

/**
 * Açúcar para o call site de dispatch (S11): resolve cap+gasto a partir do
 * `ResolvedPolicy` de `resolvePolicy` e aplica o guard com um custo estimado.
 */
export function guardResolved(resolved: ResolvedPolicy, estimatedCostUsd: number): BudgetDecision {
  return assertWithinBudget({
    workspaceId: resolved.workspaceId,
    policy: resolved.policy,
    monthToDateSpendUsd: resolved.monthToDateSpendUsd,
    estimatedCostUsd,
  });
}
