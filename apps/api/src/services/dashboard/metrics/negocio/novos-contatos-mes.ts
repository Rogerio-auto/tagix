import type { MetricModule } from '../types';
import { OWNER_ONLY } from '../types';
import { novosContatosMes } from '../../queries';

export const novosContatosMesMetric: MetricModule = {
  def: {
    key: 'novos_contatos_mes',
    label: 'Novos contatos (mês)',
    category: 'negocio',
    roles: OWNER_ONLY,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/contacts?period=mes`,
  },
  resolve: (ctx) => novosContatosMes(ctx.tx),
};
