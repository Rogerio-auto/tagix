/**
 * Drill-down de métrica (DASHBOARD.md §8 — `GET /dashboard/metrics/:key`).
 *
 * Retorna a forma detalhada (série temporal ou tabela) de uma métrica para a qual
 * o role tem direito. O despacho é 100% via registry: cada módulo declara seu próprio
 * `drill` (co-locado com a definição). A autorização é a mesma do §8: se o role não
 * pode ver a métrica, é 403 (nunca 404 silencioso → evita inferência); métrica sem
 * `drill` ou sem detalhe → 204; param inválido → 404 (não exfiltra).
 */
import type { Role } from '@hm/shared';
import type { DbTx } from '@hm/db';
import { getMetricModule, metricVisibleTo } from './metrics/registry';
import type { MetricCtx } from './metrics/types';
import type { MetricValue } from './queries';

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
  /** Parâmetro opcional do drill-down (ex.: categoria de objeção). */
  readonly param?: string;
}

export async function drillDown(tx: DbTx, args: DrillArgs): Promise<DrillResult> {
  const mod = getMetricModule(args.metricKey);
  if (!mod) return { kind: 'unknown_metric' };
  // Autorização: o role precisa enxergar a métrica (mesma decisão do load §8).
  if (!metricVisibleTo(mod.def, args.role)) return { kind: 'forbidden' };
  // Métricas escalares cujo drill-down é navegação (§4 drillHref), não série, não têm `drill`.
  if (!mod.drill) return { kind: 'no_detail' };

  const ctx: MetricCtx = {
    tx,
    workspaceId: args.workspaceId,
    memberId: args.memberId,
    role: args.role,
    scope: mod.def.scope,
  };
  const outcome = await mod.drill(ctx, { param: args.param });
  switch (outcome.kind) {
    case 'ok':
      return { kind: 'ok', metricKey: mod.def.key, detail: outcome.detail };
    case 'unknown_metric':
      return { kind: 'unknown_metric' };
    case 'no_detail':
      return { kind: 'no_detail' };
  }
}
