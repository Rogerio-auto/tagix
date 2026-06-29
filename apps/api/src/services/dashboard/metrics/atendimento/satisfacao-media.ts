import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { satisfacaoMedia } from '../../queries';

export const satisfacaoMediaMetric: MetricModule = {
  def: {
    key: 'satisfacao_media',
    label: 'Satisfação (CSAT, 30d)',
    category: 'atendimento',
    roles: SUP_RO,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'stat',
  },
  resolve: (ctx) => satisfacaoMedia(ctx.tx),
};
