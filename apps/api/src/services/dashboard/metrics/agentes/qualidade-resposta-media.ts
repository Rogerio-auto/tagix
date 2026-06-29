import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { qualidadeRespostaMedia } from '../../queries';

export const qualidadeRespostaMediaMetric: MetricModule = {
  def: {
    key: 'qualidade_resposta_media',
    label: 'Qualidade média (30d)',
    category: 'agentes',
    roles: SUP_RO,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'stat',
  },
  resolve: (ctx) => qualidadeRespostaMedia(ctx.tx),
};
