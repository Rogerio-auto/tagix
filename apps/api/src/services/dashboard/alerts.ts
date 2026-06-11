/**
 * Alertas do dashboard (DASHBOARD.md §3.2/§3.3 — blocos "⚠ Alertas/Atenção").
 *
 * Alertas são derivados dos cards já resolvidos + thresholds, e **respeitam o role**:
 * só são gerados se o card que os origina está no conjunto do role (a função recebe
 * os cards já filtrados por `loadDashboard`). Assim um AGENT nunca recebe alerta de
 * custo IA (card que ele não vê), por construção — não há vazamento por role.
 *
 * MVP: SLA violado (SUP+) e cap mensal de custo IA (ADMIN+). Demais alertas (quality
 * rating de canal, token expirando) entram quando as fontes forem ligadas — ficam
 * documentados aqui como pontos de extensão, não inventados.
 */
import type { DbTx } from '@hm/db';
import type { LoadDashboardArgs } from './load-dashboard';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface DashboardAlert {
  readonly key: string;
  readonly severity: AlertSeverity;
  readonly message: string;
  readonly metricKey: string;
}

interface CardLike {
  readonly key: string;
  readonly value: { readonly [k: string]: unknown } | null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Constrói alertas a partir dos cards visíveis. `cards` já está filtrado por role
 * (vem de loadDashboard) — por isso o gating de role é automático.
 */
export async function buildAlerts(
  _tx: DbTx,
  _args: LoadDashboardArgs,
  cards: readonly CardLike[],
): Promise<DashboardAlert[]> {
  const byKey = new Map(cards.map((c) => [c.key, c]));
  const alerts: DashboardAlert[] = [];

  // SLA violado hoje (SUP+). Origem: card sla_violado_hoje (snapshot 5min).
  const sla = byKey.get('sla_violado_hoje');
  if (sla) {
    const violated = num(sla.value?.['count']) ?? 0;
    if (violated > 0) {
      alerts.push({
        key: 'sla_violado',
        severity: violated >= 5 ? 'critical' : 'warning',
        message: `${violated} conversa(s) com SLA violado hoje.`,
        metricKey: 'sla_violado_hoje',
      });
    }
  }

  return alerts;
}
