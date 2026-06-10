/**
 * Tipos do motor de automacoes de stage (F5-S06, PIPELINE.md 3).
 *
 * Reusa o contrato `AutomationRule` de @hm/db (fonte unica) e define as portas
 * de execucao (DI). Os handlers reais de cada action vivem fora deste pacote:
 *   - trigger_flow  -> @hm/flow-engine (F4)
 *   - add_tag/remove_tag/register_conversion -> F5-S14/S16
 * O bootstrap injeta o `ActionExecutor`; aqui so roteamos e gerimos retry.
 */
import type { schema } from '@hm/db';

/** Contrato unico da rule (espelha @hm/db pipeline.ts). */
export type AutomationRule = (typeof schema.pendingAutomations.$inferSelect)['rule'];

export type AutomationTrigger = 'on_enter' | 'on_exit' | 'on_stale';

/** Contexto de uma automacao agendada (o que o executor recebe). */
export interface AutomationContext {
  readonly workspaceId: string;
  readonly dealId: string;
  readonly pipelineId: string;
  readonly fromStageId?: string;
  readonly toStageId?: string;
}

/** Uma linha de pending_automations pronta p/ executar. */
export interface PendingAutomationRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly dealId: string;
  readonly rule: AutomationRule;
  readonly attempts: number;
}

/**
 * Executor de uma action — injetado pelo bootstrap. Lanca em falha (o drainer
 * aplica retry/backoff). Retornar normalmente = sucesso.
 */
export type ActionExecutor = (row: PendingAutomationRow) => Promise<void>;
