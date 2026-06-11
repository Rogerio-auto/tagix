/**
 * Catálogo de métricas/cards do dashboard (DASHBOARD.md §2, §3, §4) + resolução
 * role-aware (§8). Esta é a fonte da verdade do **server-driven dashboard**: o
 * servidor decide quais cards um role pode ver; o frontend nunca esconde com
 * `if (role)` (anti-padrão v1 §10).
 *
 * Cada métrica declara:
 *  - `roles`: quem pode ver (PERMISSIONS §1 — hierarquia aditiva já expandida aqui).
 *  - `category`: agrupamento visual (atendimento, pipeline, conversões, ...).
 *  - `cadence`: como atualiza (socket | snapshot_5min | mv_1h | mv_1d) — guia o front
 *     (refetchInterval) e o backend (de onde lê: query viva vs snapshot vs MV).
 *  - `scope`: recorte natural — `personal` (do member), `team` (supervisão) ou
 *     `workspace`. Determina o `scope` jsonb da snapshot e a filtragem fina.
 *  - `drillHref`: destino do clique (§4) — função do contexto (member id etc.).
 *  - `requiresConversionType`: card de conversão só aparece se o workspace tem ≥1
 *     conversion_type configurado (§13 / §2.5).
 *  - `cardType`: tipo de render no registry do front (S03) — stat | chart | table | alert.
 */
import type { Role } from '@hm/shared';

export type MetricCadence = 'socket' | 'snapshot_5min' | 'mv_1h' | 'mv_1d';
export type MetricScope = 'personal' | 'team' | 'workspace';
export type CardType = 'stat' | 'chart' | 'table' | 'list';
export type MetricCategory =
  | 'atendimento'
  | 'pipeline'
  | 'campanhas'
  | 'agentes'
  | 'conversoes'
  | 'negocio';

/** Contexto usado para materializar drill-down hrefs por member. */
export interface DrillContext {
  readonly memberId: string;
}

export interface MetricDefinition {
  readonly key: string;
  readonly label: string;
  readonly category: MetricCategory;
  readonly roles: readonly Role[];
  readonly cadence: MetricCadence;
  readonly scope: MetricScope;
  readonly cardType: CardType;
  readonly drillHref?: (ctx: DrillContext) => string;
  readonly requiresConversionType?: boolean;
}

// Atalhos de role (hierarquia aditiva já expandida — §1: ADMIN vê SUP+AGENT etc.).
const AGENT_UP = ['AGENT', 'SUPERVISOR', 'ADMIN', 'OWNER'] as const;
const SUP_UP = ['SUPERVISOR', 'ADMIN', 'OWNER'] as const;
const OWNER_ONLY = ['OWNER'] as const;
// READONLY enxerga o que o ADMIN enxerga, porém sem ação (§3.5) — o front renderiza
// os mesmos cards informativos. Por isso READONLY entra junto dos cards ADMIN-level.
const ADMIN_RO = ['ADMIN', 'OWNER', 'READONLY'] as const;
const SUP_RO = ['SUPERVISOR', 'ADMIN', 'OWNER', 'READONLY'] as const;
const AGENT_RO = ['AGENT', 'SUPERVISOR', 'ADMIN', 'OWNER', 'READONLY'] as const;

/**
 * Registry de métricas. Ordem = ordem de implementação/exibição (§2). Mantido
 * deliberadamente focado no conjunto MVP coberto por queries reais nesta fase;
 * métricas estratégicas pesadas (ROI/CAC/MRR §2.6) ficam declaradas mas marcadas
 * para preenchimento futuro (retornam null → o front não renderiza card vazio).
 */
export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  // ── §2.1 Atendimento ────────────────────────────────────────────────────────
  {
    key: 'minhas_conversas_abertas',
    label: 'Minhas abertas',
    category: 'atendimento',
    roles: ['AGENT'],
    cadence: 'socket',
    scope: 'personal',
    cardType: 'stat',
    drillHref: (c) => `/conversations?assigned_to=${c.memberId}&status=open`,
  },
  {
    key: 'minha_fila_pendente',
    label: 'Em fila',
    category: 'atendimento',
    roles: ['AGENT'],
    cadence: 'socket',
    scope: 'personal',
    cardType: 'stat',
    drillHref: (c) => `/conversations?assigned_to=${c.memberId}&status=pending`,
  },
  {
    key: 'aguardando_atribuicao',
    label: 'Aguardando atribuição',
    category: 'atendimento',
    roles: SUP_RO,
    cadence: 'socket',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/conversations?assigned_to=null&status=pending`,
  },
  {
    key: 'em_atendimento_ia',
    label: 'IA rodando',
    category: 'atendimento',
    roles: AGENT_RO,
    cadence: 'socket',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/conversations?ai_mode=on`,
  },
  {
    key: 'sla_violado_hoje',
    label: 'SLA violado hoje',
    category: 'atendimento',
    roles: SUP_RO,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/conversations?sla=violated&period=today`,
  },
  {
    key: 'resolvidas_hoje_por_mim',
    label: 'Resolvidas hoje',
    category: 'atendimento',
    roles: ['AGENT', 'SUPERVISOR', 'ADMIN'],
    cadence: 'snapshot_5min',
    scope: 'personal',
    cardType: 'stat',
  },
  {
    key: 'volume_inbound_24h',
    label: 'Volume inbound (24h)',
    category: 'atendimento',
    roles: SUP_RO,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'chart',
  },
  {
    key: 'volume_outbound_24h',
    label: 'Volume outbound (24h)',
    category: 'atendimento',
    roles: SUP_RO,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'chart',
  },
  {
    key: 'inbox_por_departamento',
    label: 'Inbox por departamento',
    category: 'atendimento',
    roles: SUP_RO,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'table',
  },
  // ── §2.2 Pipeline ────────────────────────────────────────────────────────────
  {
    key: 'valor_total_pipeline',
    label: 'Pipeline aberto',
    category: 'pipeline',
    roles: SUP_RO,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/pipeline`,
  },
  {
    key: 'deals_fechados_ganho_mes',
    label: 'Fechados (ganho) no mês',
    category: 'pipeline',
    roles: SUP_RO,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/pipeline?closed=won&period=mes`,
  },
  // ── §2.4 Agentes IA ──────────────────────────────────────────────────────────
  {
    key: 'custo_llm_hoje_usd',
    label: 'Custo IA hoje',
    category: 'agentes',
    roles: ADMIN_RO,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/settings/usage?period=today`,
  },
  {
    key: 'custo_llm_mes_usd',
    label: 'Custo IA no mês',
    category: 'agentes',
    roles: ADMIN_RO,
    cadence: 'mv_1d',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/settings/usage?period=mes`,
  },
  // ── §2.5 Conversões (gated por conversion_type — §13) ────────────────────────
  {
    key: 'conversoes_minhas_mes',
    label: 'Minhas conversões (mês)',
    category: 'conversoes',
    roles: AGENT_UP,
    cadence: 'snapshot_5min',
    scope: 'personal',
    cardType: 'stat',
    requiresConversionType: true,
    drillHref: (c) => `/conversions?member_id=${c.memberId}&period=mes`,
  },
  {
    key: 'conversoes_workspace_mes',
    label: 'Conversões do workspace (mês)',
    category: 'conversoes',
    roles: SUP_UP,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'stat',
    requiresConversionType: true,
    drillHref: () => `/conversions?period=mes`,
  },
  {
    key: 'valor_convertido_workspace_mes',
    label: 'Valor convertido (mês)',
    category: 'conversoes',
    roles: SUP_UP,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'stat',
    requiresConversionType: true,
    drillHref: () => `/conversions?period=mes`,
  },
  {
    key: 'conversoes_por_tipo',
    label: 'Conversões por tipo',
    category: 'conversoes',
    roles: SUP_UP,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'chart',
    requiresConversionType: true,
    drillHref: () => `/conversions?group_by=type`,
  },
  // ── §2.6 Negócio (OWNER) ─────────────────────────────────────────────────────
  {
    key: 'novos_contatos_mes',
    label: 'Novos contatos (mês)',
    category: 'negocio',
    roles: OWNER_ONLY,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/contacts?period=mes`,
  },
  {
    key: 'contatos_total_workspace',
    label: 'Contatos no total',
    category: 'negocio',
    roles: OWNER_ONLY,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/contacts`,
  },
];

/** Índice por key para lookup O(1). */
export const METRIC_BY_KEY: ReadonlyMap<string, MetricDefinition> = new Map(
  METRIC_DEFINITIONS.map((m) => [m.key, m]),
);

/** Uma métrica é visível para `role`? (decisão de autorização do §8). */
export function metricVisibleTo(metric: MetricDefinition, role: Role): boolean {
  return metric.roles.includes(role);
}

/**
 * Conjunto de métricas que `role` pode ver, na ordem do registry. Aplica o gate
 * de conversão: cards `requiresConversionType` só entram se `hasConversionType`.
 */
export function metricsForRole(role: Role, hasConversionType: boolean): MetricDefinition[] {
  return METRIC_DEFINITIONS.filter(
    (m) => metricVisibleTo(m, role) && (!m.requiresConversionType || hasConversionType),
  );
}
