/**
 * Drill-down de métrica (DASHBOARD.md §8 — `GET /dashboard/metrics/:key`).
 *
 * Retorna a forma detalhada (série temporal ou tabela) de uma métrica para a qual
 * o role tem direito. Reaproveita as queries do load. A autorização é a mesma do §8:
 * se o role não pode ver a métrica, é 403 (nunca 404 silencioso → evita inferência).
 */
import type { Role } from '@hm/shared';
import type { DbTx } from '@hm/db';
import { METRIC_BY_KEY, metricVisibleTo } from './definitions';
import {
  conversoesMinhasMes,
  inboxPorDepartamento,
  readConversionsMonth,
  readVolume24h,
  type MetricValue,
} from './queries';

export type DrillResult =
  | { kind: 'ok'; metricKey: string; detail: MetricValue }
  | { kind: 'unknown_metric' }
  | { kind: 'forbidden' }
  | { kind: 'no_detail' };

export interface DrillArgs {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly role: Role;
  readonly metricKey: string;
}

export async function drillDown(tx: DbTx, args: DrillArgs): Promise<DrillResult> {
  const metric = METRIC_BY_KEY.get(args.metricKey);
  if (!metric) return { kind: 'unknown_metric' };
  if (!metricVisibleTo(metric, args.role)) return { kind: 'forbidden' };

  switch (metric.key) {
    case 'volume_inbound_24h':
    case 'volume_outbound_24h':
      return { kind: 'ok', metricKey: metric.key, detail: await readVolume24h(tx, args.workspaceId) };
    case 'conversoes_por_tipo':
      return {
        kind: 'ok',
        metricKey: metric.key,
        detail: await readConversionsMonth(tx, args.workspaceId),
      };
    case 'inbox_por_departamento':
      return { kind: 'ok', metricKey: metric.key, detail: await inboxPorDepartamento(tx) };
    case 'conversoes_minhas_mes':
      return {
        kind: 'ok',
        metricKey: metric.key,
        detail: await conversoesMinhasMes(tx, args.memberId),
      };
    default:
      // Métricas escalares cujo drill-down é navegação (§4 drillHref), não série.
      return { kind: 'no_detail' };
  }
}
