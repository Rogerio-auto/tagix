import type { MetricModule } from '../types';
import { minhasConversasAbertas } from '../../queries';

export const minhasConversasAbertasMetric: MetricModule = {
  def: {
    key: 'minhas_conversas_abertas',
    label: 'Minhas abertas',
    category: 'atendimento',
    roles: ['AGENT'],
    cadence: 'socket',
    scope: 'personal',
    cardType: 'stat',
    drillHref: (c) => `/conversations?assigned_to=${c.memberId}&status=open`,
  },
  resolve: (ctx) => minhasConversasAbertas(ctx.tx, ctx.memberId),
};
