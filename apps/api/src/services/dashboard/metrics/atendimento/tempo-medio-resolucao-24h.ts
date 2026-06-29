import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { tempoMedioResolucao24h } from '../../queries';

/** Tempo médio de resolução (24h). Lê `resolved_at`/`closed_at` (F55-S01). */
export const tempoMedioResolucao24hMetric: MetricModule = {
  def: {
    key: 'tempo_medio_resolucao_24h',
    label: 'Tempo médio de resolução (24h)',
    category: 'atendimento',
    roles: SUP_RO,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'stat',
  },
  resolve: (ctx) => tempoMedioResolucao24h(ctx.tx, ctx.workspaceId),
};
