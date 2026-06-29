import type { MetricModule } from '../types';
import { AGENT_RO } from '../types';
import { tempoMedioPrimeiraResposta24h } from '../../queries';

/**
 * Tempo médio de 1ª resposta (24h). Lê o marco `first_response_at` (F55-S01). Scope
 * `personal` → restringe ao próprio atendente atribuído (AGENT vê a própria média).
 */
export const tempoMedioPrimeiraResposta24hMetric: MetricModule = {
  def: {
    key: 'tempo_medio_primeira_resposta_24h',
    label: 'Tempo médio 1ª resposta (24h)',
    category: 'atendimento',
    roles: AGENT_RO,
    cadence: 'snapshot_5min',
    scope: 'personal',
    cardType: 'stat',
  },
  resolve: (ctx) =>
    tempoMedioPrimeiraResposta24h(
      ctx.tx,
      ctx.workspaceId,
      ctx.scope === 'personal' ? ctx.memberId : undefined,
    ),
};
