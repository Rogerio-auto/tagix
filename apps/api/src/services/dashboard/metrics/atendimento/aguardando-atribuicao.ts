import type { MetricModule } from '../types';
import { SUP_RO } from '../types';
import { aguardandoAtribuicao } from '../../queries';

export const aguardandoAtribuicaoMetric: MetricModule = {
  def: {
    key: 'aguardando_atribuicao',
    label: 'Aguardando atribuição',
    category: 'atendimento',
    roles: SUP_RO,
    cadence: 'socket',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/conversations?assigned_to=null&status=pending`,
  },
  resolve: (ctx) => aguardandoAtribuicao(ctx.tx),
};
