import type { MetricModule } from '../types';
import { AGENT_RO } from '../types';
import { emAtendimentoIa } from '../../queries';

export const emAtendimentoIaMetric: MetricModule = {
  def: {
    key: 'em_atendimento_ia',
    label: 'IA rodando',
    category: 'atendimento',
    roles: AGENT_RO,
    cadence: 'socket',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/conversations?ai_mode=on`,
  },
  resolve: (ctx) => emAtendimentoIa(ctx.tx),
};
