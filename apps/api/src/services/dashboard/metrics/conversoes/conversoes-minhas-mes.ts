import type { MetricModule } from '../types';
import { AGENT_UP } from '../types';
import { conversoesMinhasMes } from '../../queries';

export const conversoesMinhasMesMetric: MetricModule = {
  def: {
    key: 'conversoes_minhas_mes',
    label: 'Minhas conversões (mês)',
    category: 'conversoes',
    roles: AGENT_UP,
    cadence: 'snapshot_5min',
    scope: 'personal',
    cardType: 'stat',
    requiresConversionType: true,
    drillHref: (c) => `/conversions?member_id=${c.memberId}&period=mes`,
  },
  resolve: (ctx) => conversoesMinhasMes(ctx.tx, ctx.memberId),
  drill: async (ctx) => ({
    kind: 'ok',
    detail: await conversoesMinhasMes(ctx.tx, ctx.memberId),
  }),
};
