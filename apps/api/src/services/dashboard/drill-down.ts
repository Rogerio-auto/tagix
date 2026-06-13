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
  performancePorAtendente,
  inboxPorCanal,
  tokensPorModelo24h,
  conversoesPorAtendenteHumano,
  conversoesPorAgenteIa,
  objecoesRankeadas,
  objecoesExemplos,
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
  /** Parâmetro opcional do drill-down (ex.: categoria de objeção). */
  readonly param?: string;
}

const OBJECTION_CATEGORIES = new Set([
  'price',
  'timing',
  'trust',
  'competitor',
  'feature_gap',
  'authority',
  'other',
]);

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
    // Onda A: tabelas column-aware que abrem drawer detalhado.
    case 'performance_por_atendente':
      return {
        kind: 'ok',
        metricKey: metric.key,
        detail: await performancePorAtendente(tx, args.workspaceId),
      };
    case 'inbox_por_canal':
      return { kind: 'ok', metricKey: metric.key, detail: await inboxPorCanal(tx) };
    case 'tokens_por_modelo_24h':
      return {
        kind: 'ok',
        metricKey: metric.key,
        detail: await tokensPorModelo24h(tx, args.workspaceId),
      };
    case 'conversoes_por_atendente_humano':
      return {
        kind: 'ok',
        metricKey: metric.key,
        detail: await conversoesPorAtendenteHumano(tx),
      };
    case 'conversoes_por_agente_ia':
      return {
        kind: 'ok',
        metricKey: metric.key,
        detail: await conversoesPorAgenteIa(tx),
      };
    case 'objecoes_rankeadas': {
      // Com `param` (categoria válida) → exemplos (excerpt) daquela objeção (drawer).
      // Sem param → o próprio ranking (tabela). Categoria inválida → unknown (evita
      // exfiltração por categoria arbitrária).
      if (args.param !== undefined) {
        if (!OBJECTION_CATEGORIES.has(args.param)) return { kind: 'unknown_metric' };
        return {
          kind: 'ok',
          metricKey: metric.key,
          detail: await objecoesExemplos(tx, args.param),
        };
      }
      const ranked = await objecoesRankeadas(tx);
      if (ranked === null) return { kind: 'no_detail' };
      return { kind: 'ok', metricKey: metric.key, detail: ranked };
    }
    default:
      // Métricas escalares cujo drill-down é navegação (§4 drillHref), não série.
      return { kind: 'no_detail' };
  }
}
