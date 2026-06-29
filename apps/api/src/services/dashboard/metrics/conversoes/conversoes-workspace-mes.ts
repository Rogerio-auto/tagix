import type { MetricModule } from '../types';
import { SUP_UP } from '../types';
import { conversoesWorkspaceMes } from '../../queries';

export const conversoesWorkspaceMesMetric: MetricModule = {
  def: {
    key: 'conversoes_workspace_mes',
    label: 'Conversões do workspace (mês)',
    category: 'conversoes',
    roles: SUP_UP,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'stat',
    requiresConversionType: true,
    drillHref: () => `/conversions?period=mes`,
  },
  resolve: (ctx) => conversoesWorkspaceMes(ctx.tx),
};
