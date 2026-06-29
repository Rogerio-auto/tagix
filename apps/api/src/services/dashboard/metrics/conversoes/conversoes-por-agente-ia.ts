import type { MetricModule } from '../types';
import { SUP_UP } from '../types';
import { conversoesPorAgenteIa } from '../../queries';

export const conversoesPorAgenteIaMetric: MetricModule = {
  def: {
    key: 'conversoes_por_agente_ia',
    label: 'Ranking — conversões por agente IA',
    category: 'conversoes',
    roles: SUP_UP,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'table',
    requiresConversionType: true,
    drillHref: () => `/conversions?group_by=agent&period=mes`,
  },
  resolve: (ctx) => conversoesPorAgenteIa(ctx.tx),
  drill: async (ctx) => ({
    kind: 'ok',
    detail: await conversoesPorAgenteIa(ctx.tx),
  }),
};
