import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { serieDesempenho30d } from '../../queries';

export const desempenho30dMetric: MetricModule = {
  def: {
    key: 'desempenho_30d',
    label: 'Desempenho (30 dias)',
    category: 'negocio',
    roles: SUP_RO,
    cadence: 'mv_1d',
    scope: 'workspace',
    cardType: 'timeseries',
  },
  resolve: (ctx) => serieDesempenho30d(ctx.tx, ctx.workspaceId),
};
