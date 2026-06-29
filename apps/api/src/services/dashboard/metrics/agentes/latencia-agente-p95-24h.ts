import type { MetricModule } from '../types';
import { ADMIN_RO } from '../types';
import { latenciaAgenteP9524h } from '../../queries';

export const latenciaAgenteP9524hMetric: MetricModule = {
  def: {
    key: 'latencia_agente_p95_24h',
    label: 'Latência p95 do agente (24h)',
    category: 'agentes',
    roles: ADMIN_RO,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'stat',
  },
  resolve: (ctx) => latenciaAgenteP9524h(ctx.tx, ctx.workspaceId),
};
