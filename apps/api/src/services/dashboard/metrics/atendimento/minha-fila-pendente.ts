import type { MetricModule } from '../types';
import { minhaFilaPendente } from '../../queries';

export const minhaFilaPendenteMetric: MetricModule = {
  def: {
    key: 'minha_fila_pendente',
    label: 'Em fila',
    category: 'atendimento',
    roles: ['AGENT'],
    cadence: 'socket',
    scope: 'personal',
    cardType: 'stat',
    drillHref: (c) => `/conversations?assigned_to=${c.memberId}&status=pending`,
  },
  resolve: (ctx) => minhaFilaPendente(ctx.tx, ctx.memberId),
};
