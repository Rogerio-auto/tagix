import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { inboxPorCanal } from '../../queries';

export const inboxPorCanalMetric: MetricModule = {
  def: {
    key: 'inbox_por_canal',
    label: 'Inbox por canal',
    category: 'atendimento',
    roles: SUP_RO,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'table',
  },
  resolve: (ctx) => inboxPorCanal(ctx.tx),
  drill: async (ctx) => ({ kind: 'ok', detail: await inboxPorCanal(ctx.tx) }),
};
