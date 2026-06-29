import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { readSnapshot, slaVioladoHoje } from '../../queries';

/**
 * SLA violado hoje (SUP+). Fonte primária é a snapshot 5min (cálculo precomputado pelo
 * job); se ainda não populada, faz fallback para a query live (F55-S01 — compara os
 * marcos `first_response_at`/`resolved_at` vs `sla_rules`, sem varrer `messages`).
 * Shape `{ count }` em ambos os caminhos.
 */
export const slaVioladoHojeMetric: MetricModule = {
  def: {
    key: 'sla_violado_hoje',
    label: 'SLA violado hoje',
    category: 'atendimento',
    roles: SUP_RO,
    cadence: 'snapshot_5min',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/conversations?sla=violated&period=today`,
  },
  resolve: async (ctx) => {
    const snapshot = await readSnapshot(ctx.tx, 'sla_violado_hoje', {});
    if (snapshot) return snapshot;
    return slaVioladoHoje(ctx.tx);
  },
};
