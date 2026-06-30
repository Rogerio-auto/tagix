import type { MetricModule } from '../types';
import { SUP_UP } from '../types';
import { agenteResolucoes24h } from '../../queries';

export const agenteResolucoes24hMetric: MetricModule = {
  def: {
    key: 'agente_resolucoes_24h',
    label: 'Resoluções da IA (24h)',
    category: 'agentes',
    roles: SUP_UP,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'stat',
  },
  resolve: (ctx) => agenteResolucoes24h(ctx.tx),
};
