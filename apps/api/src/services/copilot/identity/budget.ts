/**
 * Estado do orçamento mensal do Copiloto (COPILOTO.md P8, §5.2; ADR-003 §3.6).
 *
 * O Copiloto tem orçamento PRÓPRIO, separado do dos agentes de atendimento: a soma lê só
 * `llm_usage_logs.surface = 'copilot'`. Assim o Copiloto nunca derruba o atendimento, e o
 * atendimento nunca trava o Copiloto.
 *
 * A soma é LOCAL a este slot (F73-S03). O F73-S10 dá o filtro `surface` ao
 * `monthToDateSpendUsd` do `@hm/agents-core` e substitui `monthToDateCopilotSpendUsd` por ele.
 * A janela é o mês corrente em UTC, a mesma do teto dos agentes.
 *
 *   gasto < alerta                    → ok
 *   alerta ≤ gasto < teto             → alert
 *   gasto ≥ teto, modo `pause`        → paused       (nada passa)
 *   gasto ≥ teto, modo `queries_only` → queries_only (escritas param; consultas seguem)
 *   gasto ≥ teto × 120 %              → paused       (teto duro: nem consulta)
 */
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { schema, type CopilotSettingsView, type DbTx } from '@hm/db';
import type { CopilotBudgetMode, CopilotBudgetState } from '@hm/shared';

/**
 * Teto duro das CONSULTAS no modo `queries_only`, como fração do teto mensal.
 * PROVISÓRIO: 120 % depende da decisão de preço do Rogério (COPILOTO.md P8). Mude só aqui.
 */
export const COPILOT_QUERY_HARD_CEILING_RATIO = 1.2;

/** Primeiro instante do mês corrente em UTC. */
export function monthStartUtc(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/** Primeiro instante do próximo mês em UTC (quando o orçamento zera). */
export function nextMonthStartUtc(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}

/** `YYYY-MM-DD` do dia em que o orçamento zera. */
export function budgetResetsOn(at: Date): string {
  return nextMonthStartUtc(at).toISOString().slice(0, 10);
}

export interface BudgetStateInput {
  readonly spentUsd: number;
  readonly capUsd: number;
  /** 1..100. */
  readonly alertPct: number;
  readonly mode: CopilotBudgetMode;
}

/** Função pura: estado do orçamento a partir do gasto e da configuração. */
export function computeBudgetState(input: BudgetStateInput): CopilotBudgetState {
  const { spentUsd, capUsd, alertPct, mode } = input;
  // Valores não finitos (numeric corrompido) falham fechado: tratados como estourados.
  if (!Number.isFinite(spentUsd) || !Number.isFinite(capUsd)) return 'paused';
  if (spentUsd >= capUsd) {
    if (mode === 'pause') return 'paused';
    return spentUsd >= capUsd * COPILOT_QUERY_HARD_CEILING_RATIO ? 'paused' : 'queries_only';
  }
  return spentUsd >= (capUsd * alertPct) / 100 ? 'alert' : 'ok';
}

/**
 * Gasto do Copiloto no mês corrente (UTC), sob o `tx` RLS do workspace. Usa o índice
 * (`workspace_id`, `surface`, `created_at desc`) de `llm_usage_logs`. Gasto de teste
 * (`is_test`, playground) não conta, como no rollup de produção.
 */
export async function monthToDateCopilotSpendUsd(
  tx: DbTx,
  workspaceId: string,
  at: Date = new Date(),
): Promise<number> {
  const logs = schema.llmUsageLogs;
  const [row] = await tx
    .select({ spent: sql<string>`coalesce(sum(${logs.costUsd}), 0)::text` })
    .from(logs)
    .where(
      and(
        eq(logs.workspaceId, workspaceId),
        eq(logs.surface, 'copilot'),
        eq(logs.isTest, false),
        gte(logs.createdAt, monthStartUtc(at)),
        lt(logs.createdAt, nextMonthStartUtc(at)),
      ),
    );
  return Number(row?.spent ?? '0');
}

export interface CopilotBudget {
  readonly state: CopilotBudgetState;
  readonly spentUsd: number;
  readonly capUsd: number;
  readonly resetsOn: string;
}

/** Estado completo do orçamento (1 query). */
export async function loadCopilotBudget(
  tx: DbTx,
  settings: Pick<
    CopilotSettingsView,
    'workspaceId' | 'monthlyBudgetUsd' | 'budgetAlertPct' | 'budgetMode'
  >,
  at: Date = new Date(),
): Promise<CopilotBudget> {
  const spentUsd = await monthToDateCopilotSpendUsd(tx, settings.workspaceId, at);
  const capUsd = Number(settings.monthlyBudgetUsd);
  return {
    state: computeBudgetState({
      spentUsd,
      capUsd,
      alertPct: settings.budgetAlertPct,
      mode: settings.budgetMode,
    }),
    spentUsd,
    capUsd,
    resetsOn: budgetResetsOn(at),
  };
}
