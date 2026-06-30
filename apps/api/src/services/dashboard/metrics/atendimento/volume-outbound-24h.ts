import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { readVolume24h } from '../../queries';

/**
 * Volume outbound (24h). Compartilha a mesma fonte (`mv_dashboard_volume_24h`, série
 * por direção) com o card inbound — o front filtra a direção exibida.
 */
export const volumeOutbound24hMetric: MetricModule = {
  def: {
    key: 'volume_outbound_24h',
    label: 'Volume outbound (24h)',
    category: 'atendimento',
    roles: SUP_RO,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'chart',
  },
  resolve: (ctx) => readVolume24h(ctx.tx, ctx.workspaceId),
  drill: async (ctx) => ({ kind: 'ok', detail: await readVolume24h(ctx.tx, ctx.workspaceId) }),
};
