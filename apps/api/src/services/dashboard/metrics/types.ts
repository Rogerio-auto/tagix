/**
 * Tipos do registry declarativo de métricas (F55-S04).
 *
 * Cada métrica do dashboard é um **módulo auto-contido**: declara sua definição
 * (`def`), sabe resolver o próprio valor (`resolve`) e, quando faz sentido, o próprio
 * drill-down (`drill`). O registry (`registry.ts`) agrega todos os módulos num `Map`
 * por `key`. Adicionar um card = adicionar 1 arquivo de módulo + 1 registro — sem
 * tocar num `switch` central (o ponto de dor #1 que este slot mata).
 *
 * As definições (key/label/category/roles/cadence/scope/cardType/drillHref/
 * requiresConversionType) seguem sendo a fonte da verdade do **server-driven
 * dashboard** (DASHBOARD.md §8): o servidor decide quais cards um role vê; o frontend
 * nunca esconde com `if (role)` (anti-padrão v1 §10).
 */
import type { Role } from '@hm/shared';
import type { DbTx } from '@hm/db';
import type { MetricValue } from '../queries';

export type MetricCadence = 'socket' | 'snapshot_5min' | 'mv_1h' | 'mv_1d';
export type MetricScope = 'personal' | 'team' | 'workspace';
export type CardType =
  | 'stat'
  | 'chart'
  | 'table'
  | 'list'
  | 'leaderboard'
  | 'feed'
  | 'timeseries'
  | 'scoreboard';
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

/**
 * Definição declarativa de uma métrica/card (DASHBOARD.md §2, §3, §4):
 *  - `roles`: quem pode ver (PERMISSIONS §1 — hierarquia aditiva já expandida).
 *  - `category`: agrupamento visual (atendimento, pipeline, conversões, ...).
 *  - `cadence`: como atualiza (socket | snapshot_5min | mv_1h | mv_1d) — guia o front
 *     (refetchInterval) e o backend (de onde lê: query viva vs snapshot vs MV).
 *  - `scope`: recorte natural — `personal` (do member), `team` (supervisão) ou
 *     `workspace`. Determina o `scope` jsonb da snapshot e a filtragem fina.
 *  - `drillHref`: destino do clique (§4) — função do contexto (member id etc.).
 *  - `requiresConversionType`: card de conversão só aparece se o workspace tem ≥1
 *     conversion_type configurado (§13 / §2.5).
 *  - `cardType`: tipo de render no registry do front — stat | chart | table | alert.
 */
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

/**
 * Contexto de resolução passado a `resolve`/`drill`. Carrega a tx (já com RLS do
 * workspace), o workspace/member do auth, o role e o `scope` da própria métrica
 * (cópia de `def.scope`, conveniência para queries que filtram por escopo).
 */
export interface MetricCtx {
  readonly tx: DbTx;
  readonly workspaceId: string;
  readonly memberId: string;
  readonly role: Role;
  readonly scope: MetricScope;
}

/** Parâmetro opcional do drill-down (ex.: categoria de objeção). */
export interface MetricDrillParams {
  readonly param?: string;
}

/**
 * Resultado de um `drill` de módulo. O dispatcher central (`drill-down.ts`) adiciona
 * o `metricKey` e trata `forbidden`/módulo-sem-drill — por isso o módulo só devolve
 * o conteúdo (`ok`), `unknown_metric` (param inválido → não exfiltra) ou `no_detail`.
 */
export type MetricDrillOutcome =
  | { readonly kind: 'ok'; readonly detail: MetricValue }
  | { readonly kind: 'unknown_metric' }
  | { readonly kind: 'no_detail' };

/**
 * Módulo auto-contido de uma métrica: definição + resolução de valor + (opcional)
 * drill-down detalhado. `resolve` devolve `null` quando não há dado disponível (MV
 * ainda não populada, métrica estratégica não calculada) — o front omite o card
 * vazio em vez de exibir zero enganoso (DASHBOARD §10).
 */
export interface MetricModule {
  readonly def: MetricDefinition;
  resolve(ctx: MetricCtx): Promise<MetricValue | null>;
  drill?(ctx: MetricCtx, params: MetricDrillParams): Promise<MetricDrillOutcome>;
}

// Atalhos de role (hierarquia aditiva já expandida — §1: ADMIN vê SUP+AGENT etc.).
export const AGENT_UP = ['AGENT', 'SUPERVISOR', 'ADMIN', 'OWNER'] as const;
export const SUP_UP = ['SUPERVISOR', 'ADMIN', 'OWNER'] as const;
export const OWNER_ONLY = ['OWNER'] as const;
// READONLY enxerga o que o ADMIN enxerga, porém sem ação (§3.5) — o front renderiza
// os mesmos cards informativos. Por isso READONLY entra junto dos cards ADMIN-level.
export const ADMIN_RO = ['ADMIN', 'OWNER', 'READONLY'] as const;
export const SUP_RO = ['SUPERVISOR', 'ADMIN', 'OWNER', 'READONLY'] as const;
export const AGENT_RO = ['AGENT', 'SUPERVISOR', 'ADMIN', 'OWNER', 'READONLY'] as const;
