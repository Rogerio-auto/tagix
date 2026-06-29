import type { MetricModule } from '../types';
import { readSnapshot } from '../../queries';

export const resolvidasHojePorMimMetric: MetricModule = {
  def: {
    key: 'resolvidas_hoje_por_mim',
    label: 'Resolvidas hoje',
    category: 'atendimento',
    roles: ['AGENT', 'SUPERVISOR', 'ADMIN'],
    cadence: 'snapshot_5min',
    scope: 'personal',
    cardType: 'stat',
  },
  resolve: (ctx) => readSnapshot(ctx.tx, 'resolvidas_hoje_por_mim', { memberId: ctx.memberId }),
};
