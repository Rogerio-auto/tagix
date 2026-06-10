'use client';

import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Button, Card } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/feedback';
import { useAgentMetrics } from './queries';
import type { AgentMetric, MetricPeriod } from './types';
import { METRIC_PERIODS } from './types';

/**
 * Aba de Métricas (UX §2.7 skeleton / §2.11 erro 3-partes).
 *
 * Consome `GET /api/agents/:id/metrics` — **gap-fill do orchestrator**. Contrato:
 *   { metrics: Array<{ period, periodStart, totalTokens, totalCostUsd,
 *     totalConversations, totalMessages, errorCount, handoffCount, avgLatencyMs }> }
 * O hook degrada para `[]` em 404 → aqui isso vira o empty state "sem métricas".
 */

const PERIOD_LABEL: Record<MetricPeriod, string> = {
  day: 'Diário',
  week: 'Semanal',
  month: 'Mensal',
};

const usd = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
});
const int = new Intl.NumberFormat('pt-BR');

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR');
}

/** Soma os agregados de um conjunto de linhas para os cards de resumo. */
function summarize(rows: AgentMetric[]) {
  return rows.reduce(
    (acc, r) => ({
      totalCostUsd: acc.totalCostUsd + r.totalCostUsd,
      totalTokens: acc.totalTokens + r.totalTokens,
      totalConversations: acc.totalConversations + r.totalConversations,
      totalMessages: acc.totalMessages + r.totalMessages,
      errorCount: acc.errorCount + r.errorCount,
      handoffCount: acc.handoffCount + r.handoffCount,
    }),
    {
      totalCostUsd: 0,
      totalTokens: 0,
      totalConversations: 0,
      totalMessages: 0,
      errorCount: 0,
      handoffCount: 0,
    },
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card elevation={1} className="flex flex-col gap-1 p-4">
      <span className="font-body text-xs text-text-low">{label}</span>
      <span className="font-price text-2xl font-semibold text-text">{value}</span>
    </Card>
  );
}

export function MetricsTab({ agentId }: { agentId: string }) {
  const metrics = useAgentMetrics(agentId);
  const [period, setPeriod] = useState<MetricPeriod>('day');

  const rows = useMemo(
    () => (metrics.data ?? []).filter((m) => m.period === period),
    [metrics.data, period],
  );
  const summary = useMemo(() => summarize(rows), [rows]);

  if (metrics.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (metrics.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar as métricas"
        reason="A conexão com a API falhou ou expirou."
        whatToDo="Verifique sua conexão e tente novamente."
        action={
          <Button variant="secondary" onClick={() => void metrics.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  const hasAny = (metrics.data ?? []).length > 0;
  if (!hasAny) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Sem métricas ainda"
        description="As métricas de custo, execuções e latência aparecem aqui assim que o agente começar a processar conversas."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Seletor de período */}
      <div role="tablist" aria-label="Período" className="inline-flex gap-1 rounded-md bg-surface-2 p-1">
        {METRIC_PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={p === period}
            onClick={() => setPeriod(p)}
            className={cn(
              'rounded-sm px-3 py-1.5 font-head text-sm font-medium outline-none transition-colors duration-200',
              'focus-visible:shadow-glow-md',
              p === period ? 'bg-surface-3 text-text' : 'text-text-low hover:text-text-mid',
            )}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title={`Sem dados ${PERIOD_LABEL[period].toLowerCase()}s`}
          description="Não há métricas agregadas para este período. Tente outro intervalo."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Custo total" value={usd.format(summary.totalCostUsd)} />
            <StatCard label="Tokens" value={int.format(summary.totalTokens)} />
            <StatCard label="Conversas" value={int.format(summary.totalConversations)} />
            <StatCard label="Mensagens" value={int.format(summary.totalMessages)} />
          </div>

          <Card elevation={1} className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border-2 font-head text-xs text-text-low">
                  <th className="px-4 py-3 font-medium">Período</th>
                  <th className="px-4 py-3 text-right font-medium">Custo</th>
                  <th className="px-4 py-3 text-right font-medium">Tokens</th>
                  <th className="px-4 py-3 text-right font-medium">Conversas</th>
                  <th className="px-4 py-3 text-right font-medium">Mensagens</th>
                  <th className="px-4 py-3 text-right font-medium">Erros</th>
                  <th className="px-4 py-3 text-right font-medium">Handoffs</th>
                  <th className="px-4 py-3 text-right font-medium">Latência</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.period}-${r.periodStart}`}
                    className="border-b border-border-2 font-body text-sm text-text last:border-b-0"
                  >
                    <td className="px-4 py-3 text-text-mid">{formatDate(r.periodStart)}</td>
                    <td className="px-4 py-3 text-right font-price">{usd.format(r.totalCostUsd)}</td>
                    <td className="px-4 py-3 text-right font-price">{int.format(r.totalTokens)}</td>
                    <td className="px-4 py-3 text-right font-price">
                      {int.format(r.totalConversations)}
                    </td>
                    <td className="px-4 py-3 text-right font-price">{int.format(r.totalMessages)}</td>
                    <td
                      className={cn(
                        'px-4 py-3 text-right font-price',
                        r.errorCount > 0 ? 'text-danger' : 'text-text-low',
                      )}
                    >
                      {int.format(r.errorCount)}
                    </td>
                    <td className="px-4 py-3 text-right font-price text-text-mid">
                      {int.format(r.handoffCount)}
                    </td>
                    <td className="px-4 py-3 text-right font-price text-text-mid">
                      {r.avgLatencyMs === null ? '—' : `${int.format(Math.round(r.avgLatencyMs))} ms`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
