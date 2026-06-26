/**
 * Tipos do dashboard server-driven (F8-S03). Espelham o payload de
 * `GET /api/dashboard/me` (apps/api/src/services/dashboard). O front NÃO decide
 * visibilidade por role — consome `cards`/`alerts` já filtrados pelo servidor (§8).
 */

export type MetricCadence = 'socket' | 'snapshot_5min' | 'mv_1h' | 'mv_1d';
export type CardType =
  | 'stat'
  | 'chart'
  | 'table'
  | 'list'
  | 'leaderboard'
  | 'feed'
  | 'timeseries';
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

/**
 * Contrato column-aware dos cards `table` da Onda A (F28-S01). O servidor descreve
 * as colunas (label/align) e as linhas; o front renderiza genérico, sem hardcode de
 * schema. As linhas trazem chaves arbitrárias referenciadas por `column.key`.
 */
export type TableColumnAlign = 'left' | 'right' | 'center';

export interface TableColumn {
  readonly key: string;
  readonly label: string;
  readonly align?: TableColumnAlign;
}

export interface TableValue {
  readonly columns: TableColumn[];
  readonly rows: Record<string, unknown>[];
}

/** Lê com segurança o contrato `{columns, rows}` de um value jsonb; null se ausente. */
export function readTableValue(value: MetricValue | null): TableValue | null {
  if (!value) return null;
  const columns = value['columns'];
  const rows = value['rows'];
  if (!Array.isArray(columns) || !Array.isArray(rows)) return null;
  const cols = columns.filter(
    (c): c is TableColumn =>
      typeof c === 'object' && c !== null && typeof (c as { key?: unknown }).key === 'string',
  );
  const safeRows = rows.filter(
    (r): r is Record<string, unknown> => typeof r === 'object' && r !== null,
  );
  if (cols.length === 0) return null;
  return { columns: cols, rows: safeRows };
}

/**
 * §F29 Onda B — distribuição CSAT (promoter/neutral/detractor) + sentimento médio,
 * lida com segurança do value jsonb de `satisfacao_media`. `null` se não houver
 * amostra (o card não renderiza — sem zero enganoso).
 */
export interface CsatDistribution {
  readonly sentiment: number | null;
  readonly promoters: number;
  readonly neutrals: number;
  readonly detractors: number;
  readonly sample: number;
}

function readNum(value: MetricValue, key: string): number {
  const v = value[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function readCsatDistribution(value: MetricValue | null): CsatDistribution | null {
  if (!value) return null;
  const sample = readNum(value, 'sample');
  if (sample <= 0) return null;
  const raw = value['value'];
  return {
    sentiment: typeof raw === 'number' && Number.isFinite(raw) ? raw : null,
    promoters: readNum(value, 'promoters'),
    neutrals: readNum(value, 'neutrals'),
    detractors: readNum(value, 'detractors'),
    sample,
  };
}
