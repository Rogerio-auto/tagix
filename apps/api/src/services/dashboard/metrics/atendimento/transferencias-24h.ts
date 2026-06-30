import type { MetricModule } from '../types';
import { SUP_UP } from '../types';
import { transferencias24h } from '../../queries';

export const transferencias24hMetric: MetricModule = {
  def: {
    key: 'transferencias_24h',
    label: 'Transferências (24h)',
    category: 'atendimento',
    roles: SUP_UP,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/conversations?event=transfer&period=24h`,
  },
  resolve: (ctx) => transferencias24h(ctx.tx),
};
