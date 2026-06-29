import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { qualidadePorAgente } from '../../queries';

export const qualidadePorAgenteMetric: MetricModule = {
  def: {
    key: 'qualidade_por_agente',
    label: 'Qualidade por agente IA',
    category: 'agentes',
    roles: SUP_RO,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'table',
  },
  resolve: (ctx) => qualidadePorAgente(ctx.tx),
};
