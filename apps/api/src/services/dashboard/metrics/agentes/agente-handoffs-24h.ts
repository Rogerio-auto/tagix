import type { MetricModule } from '../types';
import { SUP_UP } from '../types';
import { agenteHandoffs24h } from '../../queries';

export const agenteHandoffs24hMetric: MetricModule = {
  def: {
    key: 'agente_handoffs_24h',
    label: 'Handoffs da IA (24h)',
    category: 'agentes',
    roles: SUP_UP,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'stat',
  },
  resolve: (ctx) => agenteHandoffs24h(ctx.tx),
};
