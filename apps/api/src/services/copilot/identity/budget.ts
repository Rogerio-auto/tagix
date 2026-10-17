/**
 * Estado do orçamento mensal do Copiloto (COPILOTO.md P8, §5.2; ADR-003 §3.6).
 *
 * O Copiloto tem orçamento PRÓPRIO, separado do dos agentes de atendimento: a soma lê só
 * `llm_usage_logs.surface = 'copilot'`. Assim o Copiloto nunca derruba o atendimento, e o
 * atendimento nunca trava o Copiloto.
 *
 * A soma e a régua de estados moram no `@hm/agents-core` (F73-S10: `monthToDateSpendUsd`
 * com `surface` e `copilotBudgetState`), ao lado do teto dos agentes: uma régua só, a mesma
 * janela (mês corrente em UTC). Este módulo é a fachada da API e mantém os nomes que o
 * F73-S03 publicou (`computeBudgetState`, `monthToDateCopilotSpendUsd`, `loadCopilotBudget`).
 *
 *   gasto < alerta                    → ok
 *   alerta ≤ gasto < teto             → alert
 *   gasto ≥ teto, modo `pause`        → paused       (nada passa)
 *   gasto ≥ teto, modo `queries_only` → queries_only (escritas param; consultas seguem)
 *   gasto ≥ teto × 120 %              → paused       (teto duro: nem consulta)
 */
import {
  COPILOT_QUERY_HARD_CEILING_RATIO as CORE_QUERY_HARD_CEILING_RATIO,
  copilotBudgetState,
  monthStartUtc as coreMonthStartUtc,
  monthToDateSpendUsd,
  nextMonthStartUtc as coreNextMonthStartUtc,
  type CopilotBudgetStateValue,
} from '@hm/agents-core';
import type { CopilotSettingsView, DbTx } from '@hm/db';
import type { CopilotBudgetMode, CopilotBudgetState } from '@hm/shared';

/**
 * Teto duro das CONSULTAS no modo `queries_only`, como fração do teto mensal.
 * PROVISÓRIO (COPILOTO.md P8). A fonte é o `@hm/agents-core`; mude lá.
 */
export const COPILOT_QUERY_HARD_CEILING_RATIO: number = CORE_QUERY_HARD_CEILING_RATIO;

// O estado do núcleo e o do contrato público são o MESMO conjunto (erro de compilação se divergirem).
const _stateParity: [CopilotBudgetStateValue, CopilotBudgetState] extends [
  CopilotBudgetState,
  CopilotBudgetStateValue,
]
  ? true
  : never = true;
void _stateParity;

/** Primeiro instante do mês corrente em UTC. */
export function monthStartUtc(at: Date): Date {
  return coreMonthStartUtc(at);
}

/** Primeiro instante do próximo mês em UTC (quando o orçamento zera). */
export function nextMonthStartUtc(at: Date): Date {
  return coreNextMonthStartUtc(at);
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
  return copilotBudgetState(
    {
      monthlyBudgetUsd: String(input.capUsd),
      budgetAlertPct: input.alertPct,
      budgetMode: input.mode,
    },
    input.spentUsd,
  );
}

/**
 * Gasto do Copiloto no mês corrente (UTC), sob o `tx` RLS do workspace. Usa o índice
 * (`workspace_id`, `surface`, `created_at desc`) de `llm_usage_logs`.
 */
export async function monthToDateCopilotSpendUsd(
  tx: DbTx,
  workspaceId: string,
  at: Date = new Date(),
): Promise<number> {
  return monthToDateSpendUsd(workspaceId, at, tx, { surface: 'copilot' });
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
    state: copilotBudgetState(settings, spentUsd),
    spentUsd,
    capUsd,
    resetsOn: budgetResetsOn(at),
  };
}
