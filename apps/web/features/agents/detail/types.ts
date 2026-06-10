/**
 * Tipos específicos da página de detalhe do agente (F2-S18). Estende os tipos
 * compartilhados de F2-S17 (`../types`) com o que só o detalhe consome: estado
 * de tools por agente e métricas agregadas.
 *
 * Owned por F2-S18. F2-S19 (playground) pode importar daqui se precisar.
 */

/* ------------------------------------------------------------------ */
/* Tools (catálogo + estado por agente)                                */
/* ------------------------------------------------------------------ */

/** Categorias soltas vindas do catálogo (string livre no banco). */
export type ToolCategory = string | null;

/**
 * Tool do catálogo já resolvida com o estado por agente.
 *
 * Vem de `GET /api/agents/:id/tools` → `{ tools: AgentToolState[] }` (F2-S16).
 * `isEnabled`/`overrides` são o estado da linha `agent_tools` (default `false`/`{}`
 * quando a tool ainda não foi atribuída ao agente).
 */
export interface AgentToolState {
  id: string;
  workspaceId: string | null;
  key: string;
  name: string;
  description: string | null;
  category: ToolCategory;
  schema: Record<string, unknown> | null;
  handlerConfig: Record<string, unknown> | null;
  isGlobal: boolean;
  isActive: boolean;
  /** Estado da linha `agent_tools` (false = não atribuída ao agente). */
  isEnabled: boolean;
  overrides: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Métricas agregadas                                                  */
/* ------------------------------------------------------------------ */

export const METRIC_PERIODS = ['day', 'week', 'month'] as const;
export type MetricPeriod = (typeof METRIC_PERIODS)[number];

/**
 * Linha de métrica agregada de um agente.
 *
 * Vem de `GET /api/agents/:id/metrics` → `{ metrics: AgentMetric[] }`.
 * **Gap-fill do orchestrator**: codificado contra este contrato exato; o hook
 * degrada para `[]` em 404 (ver `queries.ts`).
 */
export interface AgentMetric {
  period: MetricPeriod;
  /** ISO date string do início do período (ex.: `2026-06-01`). */
  periodStart: string;
  totalTokens: number;
  totalCostUsd: number;
  totalConversations: number;
  totalMessages: number;
  errorCount: number;
  handoffCount: number;
  avgLatencyMs: number | null;
}
