import type { MetricModule } from '../types';
import { SUP_UP } from '../types';
import { placarIaHumano } from '../../queries';

/**
 * Placar IA × Humano (F55-S05): conversões e receita do mês atribuídas à IA vs ao
 * atendente humano, lado a lado (cardType dedicado `scoreboard`, mapeado no S07).
 * Gated por `requiresConversionType` (sem tipo de conversão configurado o placar some).
 * Visão de equipe/negócio → SUP_UP (não vaza pro AGENT).
 */
export const placarIaHumanoMetric: MetricModule = {
  def: {
    key: 'placar_ia_humano',
    label: 'Placar IA × Humano (mês)',
    category: 'negocio',
    roles: SUP_UP,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'scoreboard',
    requiresConversionType: true,
    drillHref: () => `/conversions`,
  },
  resolve: (ctx) => placarIaHumano(ctx.tx),
};
