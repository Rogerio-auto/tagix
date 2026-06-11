/**
 * Dashboard infra (F8-S01): `dashboard_snapshots` — cache de métricas agregadas de
 * cadência 5min (DASHBOARD §5). O job do scheduler (F8-S02) popula uma linha por
 * (workspace, metric_key, scope); o frontend lê via `GET /dashboard/me`.
 *
 * `scope` (jsonb) discrimina o recorte da métrica — ex.: `{}` para workspace inteiro,
 * `{ "member_id": "..." }` para métrica pessoal de agente, `{ "team_id": "..." }` /
 * `{ "department_id": "..." }` para recortes de supervisor. `value` (jsonb) carrega
 * o payload (escalar `{ "count": 12 }`, série, breakdown por chave) — flexível por
 * metric_key, validado em runtime por Zod no serviço de métricas, não no schema.
 *
 * As materialized views `mv_dashboard_*` (cadência 1h/1d, tendências pesadas) ficam
 * na migration custom — Drizzle não modela MV; só este snapshot table.
 *
 * RLS: workspace_id próprio → isolamento direto (migration custom).
 */
import { index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const dashboardSnapshots = pgTable(
  'dashboard_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    metricKey: text('metric_key').notNull(),
    // Recorte da métrica: {} = workspace; {member_id|team_id|department_id} = subset.
    scope: jsonb('scope').$type<Record<string, string>>().notNull().default({}),
    // Payload da métrica (escalar/série/breakdown) — forma depende do metric_key.
    value: jsonb('value').$type<Record<string, unknown>>().notNull().default({}),
    computedAt: ts('computed_at').notNull().defaultNow(),
  },
  (t) => [
    // Hot-path do GET /dashboard/me: busca por workspace + metric_key.
    index('idx_dashboard_snapshots_ws_metric').on(t.workspaceId, t.metricKey),
    // Upsert do refresh job: uma linha por (workspace, metric, scope). scope canônico
    // (chaves ordenadas) garantido no serviço; jsonb igualdade estrutural na unicidade.
    unique('dashboard_snapshots_ws_metric_scope_uq').on(t.workspaceId, t.metricKey, t.scope),
    index('idx_dashboard_snapshots_computed').on(t.computedAt),
  ],
);
