import type { MetricModule } from '../types';
import { OWNER_ONLY } from '../types';
import { contatosTotalWorkspace } from '../../queries';

export const contatosTotalWorkspaceMetric: MetricModule = {
  def: {
    key: 'contatos_total_workspace',
    label: 'Contatos no total',
    category: 'negocio',
    roles: OWNER_ONLY,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/contacts`,
  },
  resolve: (ctx) => contatosTotalWorkspace(ctx.tx),
};
