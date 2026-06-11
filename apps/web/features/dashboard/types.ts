/**
 * Tipos do dashboard server-driven (F8-S03). Espelham o payload de
 * `GET /api/dashboard/me` (apps/api/src/services/dashboard). O front NÃO decide
 * visibilidade por role — consome `cards`/`alerts` já filtrados pelo servidor (§8).
 */

export type MetricCadence = 'socket' | 'snapshot_5min' | 'mv_1h' | 'mv_1d';
export type CardType = 'stat' | 'chart' | 'table' | 'list';
export type MetricCategory =
  | 'atendimento'
  | 'pipeline'
  | 'campanhas'
  | 'agentes'
  | 'conversoes'
  | 'negocio';

export type MetricValue = Record<string, unknown>;

export interface DashboardCard {
  readonly key: string;
  readonly label: string;
  readonly category: MetricCategory;
  readonly cardType: CardType;
  readonly cadence: MetricCadence;
  readonly value: MetricValue | null;
  readonly drillHref: string | null;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface DashboardAlert {
  readonly key: string;
  readonly severity: AlertSeverity;
  readonly message: string;
  readonly metricKey: string;
}

export interface DashboardLayoutPreferences {
  readonly hidden: string[];
  readonly order: string[];
  readonly period: string | null;
}

export type DashboardRole = 'AGENT' | 'SUPERVISOR' | 'ADMIN' | 'OWNER' | 'READONLY';

export interface DashboardPayload {
  readonly role: DashboardRole;
  readonly cards: DashboardCard[];
  readonly alerts: DashboardAlert[];
  readonly layoutPreferences: DashboardLayoutPreferences;
}

/** Detalhe de drill-down (`GET /dashboard/metrics/:key`). */
export interface DrillDetail {
  readonly metricKey: string;
  readonly detail: MetricValue;
}
