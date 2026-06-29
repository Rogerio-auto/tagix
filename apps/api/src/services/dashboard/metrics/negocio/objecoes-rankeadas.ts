import type { MetricModule } from '../types';
import { SUP_UP } from '../types';
import { objecoesRankeadas, objecoesExemplos } from '../../queries';

/**
 * Categorias de objeção válidas (allowlist) — uma categoria arbitrária no drill-down
 * vira `unknown_metric` (evita exfiltração por categoria forjada). Espelha o domínio
 * de `objections.category`.
 */
const OBJECTION_CATEGORIES = new Set([
  'price',
  'timing',
  'trust',
  'competitor',
  'feature_gap',
  'authority',
  'other',
]);

export const objecoesRankeadasMetric: MetricModule = {
  def: {
    key: 'objecoes_rankeadas',
    label: 'Objeções mais frequentes (30d)',
    category: 'negocio',
    roles: SUP_UP,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'table',
  },
  resolve: (ctx) => objecoesRankeadas(ctx.tx),
  // Com `param` (categoria válida) → exemplos (excerpt) daquela objeção (drawer).
  // Sem param → o próprio ranking. Categoria inválida → unknown (não exfiltra).
  drill: async (ctx, params) => {
    if (params.param !== undefined) {
      if (!OBJECTION_CATEGORIES.has(params.param)) return { kind: 'unknown_metric' };
      return { kind: 'ok', detail: await objecoesExemplos(ctx.tx, params.param) };
    }
    const ranked = await objecoesRankeadas(ctx.tx);
    if (ranked === null) return { kind: 'no_detail' };
    return { kind: 'ok', detail: ranked };
  },
};
