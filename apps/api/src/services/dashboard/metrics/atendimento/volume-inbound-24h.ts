import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { readVolume24h } from '../../queries';

export const volumeInbound24hMetric: MetricModule = {
  def: {
    key: 'volume_inbound_24h',
    label: 'Volume inbound (24h)',
    category: 'atendimento',
    roles: SUP_RO,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'chart',
  },
  resolve: (ctx) => readVolume24h(ctx.tx, ctx.workspaceId),
  drill: async (ctx) => ({ kind: 'ok', detail: await readVolume24h(ctx.tx, ctx.workspaceId) }),
};
