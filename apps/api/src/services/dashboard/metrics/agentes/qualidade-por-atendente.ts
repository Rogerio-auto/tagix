import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { qualidadePorAtendente } from '../../queries';

export const qualidadePorAtendenteMetric: MetricModule = {
  def: {
    key: 'qualidade_por_atendente',
    label: 'Qualidade por atendente',
    category: 'agentes',
    roles: SUP_RO,
    cadence: 'snapshot_5min',
    scope: 'team',
    cardType: 'table',
  },
  resolve: (ctx) => qualidadePorAtendente(ctx.tx),
};
