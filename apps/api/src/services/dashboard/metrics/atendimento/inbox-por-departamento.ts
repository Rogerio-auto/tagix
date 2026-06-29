import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { inboxPorDepartamento } from '../../queries';

export const inboxPorDepartamentoMetric: MetricModule = {
  def: {
    key: 'inbox_por_departamento',
    label: 'Inbox por departamento',
    category: 'atendimento',
    roles: SUP_RO,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'table',
  },
  resolve: (ctx) => inboxPorDepartamento(ctx.tx),
  drill: async (ctx) => ({ kind: 'ok', detail: await inboxPorDepartamento(ctx.tx) }),
};
