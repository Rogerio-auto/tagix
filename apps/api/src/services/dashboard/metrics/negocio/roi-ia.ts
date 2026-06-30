import type { MetricModule } from '../types';
import { ADMIN_RO } from '../types';
import { roiIa } from '../../queries';

/**
 * ROI da IA (F55-S05): receita atribuída à IA no mês ÷ custo de IA do mês. O custo de
 * IA é dado sensível (mesma classe dos cards de custo LLM em DASHBOARD §2.4) → ADMIN_RO.
 * `roi` é `null` quando o custo é 0 (evita divisão por zero; o front omite a razão).
 */
export const roiIaMetric: MetricModule = {
  def: {
    key: 'roi_ia',
    label: 'ROI da IA (mês)',
    category: 'negocio',
    roles: ADMIN_RO,
    cadence: 'mv_1h',
    scope: 'workspace',
    cardType: 'stat',
    drillHref: () => `/settings/usage`,
  },
  resolve: (ctx) => roiIa(ctx.tx, ctx.workspaceId),
};
