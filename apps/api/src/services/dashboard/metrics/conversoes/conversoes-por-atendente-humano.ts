import type { MetricModule } from '../types';
import { SUP_UP } from '../types';
import { conversoesPorAtendenteHumano } from '../../queries';

export const conversoesPorAtendenteHumanoMetric: MetricModule = {
  def: {
    key: 'conversoes_por_atendente_humano',
    label: 'Ranking — conversões por atendente',
    category: 'conversoes',
    roles: SUP_UP,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'table',
    requiresConversionType: true,
    drillHref: () => `/conversions?group_by=member&period=mes`,
  },
  resolve: (ctx) => conversoesPorAtendenteHumano(ctx.tx),
  drill: async (ctx) => ({
    kind: 'ok',
    detail: await conversoesPorAtendenteHumano(ctx.tx),
  }),
};
