import type { MetricModule } from '../types';
import { ADMIN_RO } from '../types';
import { tokensPorModelo24h } from '../../queries';

export const tokensPorModelo24hMetric: MetricModule = {
  def: {
    key: 'tokens_por_modelo_24h',
    label: 'Tokens por modelo (24h)',
    category: 'agentes',
    roles: ADMIN_RO,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'table',
  },
  resolve: (ctx) => tokensPorModelo24h(ctx.tx, ctx.workspaceId),
  drill: async (ctx) => ({
    kind: 'ok',
    detail: await tokensPorModelo24h(ctx.tx, ctx.workspaceId),
  }),
};
