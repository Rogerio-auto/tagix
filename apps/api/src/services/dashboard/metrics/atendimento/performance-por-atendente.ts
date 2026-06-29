import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { performancePorAtendente } from '../../queries';

export const performancePorAtendenteMetric: MetricModule = {
  def: {
    key: 'performance_por_atendente',
    label: 'Performance por atendente',
    category: 'atendimento',
    roles: SUP_RO,
    cadence: 'snapshot_5min',
    scope: 'team',
    cardType: 'table',
  },
  resolve: (ctx) => performancePorAtendente(ctx.tx, ctx.workspaceId),
  drill: async (ctx) => ({
    kind: 'ok',
    detail: await performancePorAtendente(ctx.tx, ctx.workspaceId),
  }),
};
