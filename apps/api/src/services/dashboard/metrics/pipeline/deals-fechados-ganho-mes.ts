import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { readSnapshot } from '../../queries';

export const dealsFechadosGanhoMesMetric: MetricModule = {
  def: {
    key: 'deals_fechados_ganho_mes',
    label: 'Fechados (ganho) no mês',
    category: 'pipeline',
    roles: SUP_RO,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/pipeline?closed=won&period=mes`,
  },
  resolve: (ctx) => readSnapshot(ctx.tx, 'deals_fechados_ganho_mes', {}),
};
