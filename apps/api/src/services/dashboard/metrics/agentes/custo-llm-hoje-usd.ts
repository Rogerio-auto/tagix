import type { MetricModule } from '../types';
import { ADMIN_RO } from '../types';
import { custoLlmHojeUsd } from '../../queries';

export const custoLlmHojeUsdMetric: MetricModule = {
  def: {
    key: 'custo_llm_hoje_usd',
    label: 'Custo IA hoje',
    category: 'agentes',
    roles: ADMIN_RO,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/settings/usage?period=today`,
  },
  resolve: (ctx) => custoLlmHojeUsd(ctx.tx, ctx.workspaceId),
};
