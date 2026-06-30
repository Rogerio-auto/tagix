import type { MetricModule } from '../types';
import { ADMIN_RO } from '../types';
import { capMensalConsumidoPct } from '../../queries';

export const capMensalConsumidoPctMetric: MetricModule = {
  def: {
    key: 'cap_mensal_consumido_pct',
    label: 'Cap mensal de IA consumido',
    category: 'agentes',
    roles: ADMIN_RO,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/settings/usage?period=mes`,
  },
  resolve: (ctx) => capMensalConsumidoPct(ctx.tx, ctx.workspaceId),
};
