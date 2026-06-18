'use client';

import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Button, Card } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/feedback';
import { ResponsiveTable, type ResponsiveColumn } from '@/shared/components/ResponsiveTable';
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

/** Chave estável de uma linha de métrica agregada. */
const metricRowId = (r: AgentMetric) => `${r.period}-${r.periodStart}`;

/**
 * Colunas da grade de métricas. `ResponsiveTable` renderiza tabela densa em
 * `md+` e cards escaneáveis em `< md` (a partir desta mesma config). O período é
 * a coluna `primary` do card; custo entra como `badge`; o resto vira `meta`.
 */
const METRIC_COLUMNS: readonly ResponsiveColumn<AgentMetric>[] = [
  {
    id: 'period',
    header: 'Período',
    card: 'primary',
    cell: (r) => <span className="text-text-mid md:text-text">{formatDate(r.periodStart)}</span>,
  },
  {
    id: 'cost',
    header: 'Custo',
    align: 'right',
    card: 'badge',
    cell: (r) => <span className="font-price">{usd.format(r.totalCostUsd)}</span>,
  },
  {
    id: 'tokens',
    header: 'Tokens',
    align: 'right',
    cell: (r) => <span className="font-price">{int.format(r.totalTokens)} tokens</span>,
  },
  {
    id: 'conversations',
    header: 'Conversas',
    align: 'right',
    cell: (r) => <span className="font-price">{int.format(r.totalConversations)} conv.</span>,
  },
  {
    id: 'messages',
    header: 'Mensagens',
    align: 'right',
    cell: (r) => <span className="font-price">{int.format(r.totalMessages)} msg</span>,
  },
  {
    id: 'errors',
    header: 'Erros',
    align: 'right',
    cell: (r) => (
      <span className={cn('font-price', r.errorCount > 0 ? 'text-danger' : 'text-text-low')}>
        {int.format(r.errorCount)} erros
      </span>
    ),
  },
  {
    id: 'handoffs',
    header: 'Handoffs',
    align: 'right',
    cell: (r) => (
      <span className="font-price text-text-mid">{int.format(r.handoffCount)} handoffs</span>
    ),
  },
  {
    id: 'latency',
    header: 'Latência',
    align: 'right',
    cell: (r) => (
      <span className="font-price text-text-mid">
        {r.avgLatencyMs === null ? '—' : `${int.format(Math.round(r.avgLatencyMs))} ms`}
      </span>
    ),
  },
];

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
      {/* Seletor de período — full-width segmentado no mobile (alvos ≥44px),
          compacto inline no desktop. */}
      <div
        role="tablist"
        aria-label="Período"
        className="flex w-full gap-1 rounded-md bg-surface-2 p-1 sm:inline-flex sm:w-auto"
      >
        {METRIC_PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={p === period}
            onClick={() => setPeriod(p)}
            className={cn(
              'min-h-11 flex-1 rounded-sm px-3 py-1.5 font-head text-sm font-medium outline-none transition-colors duration-200 sm:min-h-0 sm:flex-none',
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

          {/* Tabela densa (md+) → cards escaneáveis (< md). */}
          <ResponsiveTable
            rows={rows}
            columns={METRIC_COLUMNS}
            getRowId={metricRowId}
            ariaLabel="Métricas por período"
            empty={{
              icon: BarChart3,
              title: `Sem dados ${PERIOD_LABEL[period].toLowerCase()}s`,
              description: 'Não há métricas agregadas para este período. Tente outro intervalo.',
            }}
          />
        </>
      )}
    </div>
  );
}
