import type { MetricModule } from '../types';
import { SUP_UP } from '../types';
import { conversoesWorkspaceMes } from '../../queries';

/**
 * Valor convertido (mês). Compartilha a query agregada com `conversoes_workspace_mes`
 * (`{ count, valueCents }`); o front exibe a face de valor (`valueCents`).
 */
export const valorConvertidoWorkspaceMesMetric: MetricModule = {
  def: {
    key: 'valor_convertido_workspace_mes',
    label: 'Valor convertido (mês)',
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
