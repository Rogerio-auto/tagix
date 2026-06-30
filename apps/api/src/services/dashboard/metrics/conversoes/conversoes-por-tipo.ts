import type { MetricModule } from '../types';
import { SUP_UP } from '../types';
import { readConversionsMonth } from '../../queries';

export const conversoesPorTipoMetric: MetricModule = {
  def: {
    key: 'conversoes_por_tipo',
    label: 'Conversões por tipo',
    category: 'conversoes',
    roles: SUP_UP,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'chart',
    requiresConversionType: true,
    drillHref: () => `/conversions?group_by=type`,
  },
  resolve: (ctx) => readConversionsMonth(ctx.tx, ctx.workspaceId),
  drill: async (ctx) => ({
    kind: 'ok',
    detail: await readConversionsMonth(ctx.tx, ctx.workspaceId),
  }),
};
