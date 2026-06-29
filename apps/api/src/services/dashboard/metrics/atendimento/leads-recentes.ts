import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { leadsRecentes } from '../../queries';

export const leadsRecentesMetric: MetricModule = {
  def: {
    key: 'leads_recentes',
    label: 'Leads recentes',
    category: 'atendimento',
    roles: SUP_RO,
    cadence: 'socket',
    scope: 'workspace',
    cardType: 'feed',
    drillHref: () => '/contacts',
  },
  resolve: (ctx) => leadsRecentes(ctx.tx),
};
