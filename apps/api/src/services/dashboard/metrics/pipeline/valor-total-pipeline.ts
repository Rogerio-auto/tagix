import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { valorTotalPipeline } from '../../queries';

export const valorTotalPipelineMetric: MetricModule = {
  def: {
    key: 'valor_total_pipeline',
    label: 'Pipeline aberto',
    category: 'pipeline',
    roles: SUP_RO,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/pipeline`,
  },
  resolve: (ctx) => valorTotalPipeline(ctx.tx),
};
