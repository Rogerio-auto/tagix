import type { MetricModule } from '../types';
import { ADMIN_RO } from '../types';
import { readLlmCostMonth } from '../../queries';

export const custoLlmMesUsdMetric: MetricModule = {
  def: {
    key: 'custo_llm_mes_usd',
    label: 'Custo IA no mês',
    category: 'agentes',
    roles: ADMIN_RO,
    cadence: 'mv_1d',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/settings/usage?period=mes`,
  },
  resolve: (ctx) => readLlmCostMonth(ctx.tx, ctx.workspaceId),
};
