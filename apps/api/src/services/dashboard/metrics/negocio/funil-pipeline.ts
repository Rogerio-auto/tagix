import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { funilPipeline } from '../../queries';

/**
 * Funil de pipeline (F55-S05): valor aberto e contagem por estágio (ordenado por
 * `position`), com win rate do mês e ciclo médio dos ganhos como campos de resumo.
 * Visão de negócio/supervisão → SUP_RO (READONLY enxerga, AGENT não). Tabela por
 * estágio (o S07 pode render como barras a partir do mesmo contrato `{ columns, rows }`).
 */
export const funilPipelineMetric: MetricModule = {
  def: {
    key: 'funil_pipeline',
    label: 'Funil de pipeline',
    category: 'negocio',
    roles: SUP_RO,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'table',
    drillHref: () => `/pipeline`,
  },
  resolve: (ctx) => funilPipeline(ctx.tx),
};
