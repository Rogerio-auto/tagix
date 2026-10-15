'use client';

import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Skeleton,
  type DataTableColumn,
} from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { ResponsiveTable, type ResponsiveColumn } from '@/shared/components/ResponsiveTable';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { EMPTY, formatDate, formatNumber } from '@/shared/lib/locale';
import { useAgentMetrics } from './queries';
import type { AgentMetric, MetricPeriod } from './types';
import { METRIC_PERIODS } from './types';

/**
 * Aba de Métricas no DS 3.0 (F72-S07). UX §2.7 skeleton / §2.11 erro 3-partes.
 *
 * Consome `GET /api/agents/:id/metrics` — **gap-fill do orchestrator**. Contrato:
 *   { metrics: Array<{ period, periodStart, totalTokens, totalCostUsd,
 *     totalConversations, totalMessages, errorCount, handoffCount, avgLatencyMs }> }
 * O hook degrada para `[]` em 404 → aqui isso vira o empty state "sem métricas".
 *
 * Custo de LLM só aparece para quem pode agir sobre ele (`agent.view_costs`; regra 7 da
 * DS3_ADOCAO). Números em mono tabular; o custo vem em dólar (moeda do dado da API).
 */

const PERIOD_LABEL: Record<MetricPeriod, string> = {
  day: 'Diário',
  week: 'Semanal',
  month: 'Mensal',
};

/**
 * Custo de LLM em dólar (moeda do dado da API, não do componente). Fração de centavo
 * importa aqui, então formata direto pelo `formatNumber` (idioma da interface) em vez
 * do `formatMoneyUnits`, que arredonda para centavos.
 */
const COST_FORMAT = { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 } as const;
const usd = (value: number): string => formatNumber(value, COST_FORMAT);

/** Soma os agregados de um conjunto de linhas para os blocos de resumo. */
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

/** Bloco de número do DS 3.0: rótulo em mono caixa-alta, valor em mono tabular. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface px-5 py-4">
      <dt className="font-mono text-xs font-medium uppercase tracking-widest text-text-low">{label}</dt>
      <dd className="truncate font-mono text-h4 font-medium tabular-nums tracking-tight text-text md:text-h3">
        {value}
      </dd>
    </div>
  );
}

const latency = (r: AgentMetric): string =>
  r.avgLatencyMs === null ? EMPTY : `${formatNumber(Math.round(r.avgLatencyMs))} ms`;

/** Chave estável de uma linha de métrica agregada. */
const metricRowId = (r: AgentMetric) => `${r.period}-${r.periodStart}`;

function tableColumns(showCost: boolean): DataTableColumn<AgentMetric>[] {
  return [
    {
      id: 'period',
      header: 'Período',
      cell: (r) => <span className="font-mono tabular-nums text-text">{formatDate(r.periodStart)}</span>,
    },
    ...(showCost
      ? [{ id: 'cost', header: 'Custo', numeric: true, cell: (r: AgentMetric) => usd(r.totalCostUsd) }]
      : []),
    { id: 'tokens', header: 'Tokens', numeric: true, cell: (r) => formatNumber(r.totalTokens) },
    { id: 'conversations', header: 'Conversas', numeric: true, cell: (r) => formatNumber(r.totalConversations) },
    { id: 'messages', header: 'Mensagens', numeric: true, cell: (r) => formatNumber(r.totalMessages) },
    {
      id: 'errors',
      header: 'Erros',
      numeric: true,
      cell: (r) => (
        <span className={r.errorCount > 0 ? 'text-danger' : 'text-text-low'}>{formatNumber(r.errorCount)}</span>
      ),
    },
    {
      id: 'handoffs',
      header: 'Handoffs',
      numeric: true,
      cell: (r) => <span className="text-text-mid">{formatNumber(r.handoffCount)}</span>,
    },
    {
      id: 'latency',
      header: 'Latência',
      numeric: true,
      cell: (r) => <span className="text-text-mid">{latency(r)}</span>,
    },
  ];
}

/** Cards (< md): período é o título; custo (se visível) no canto; o resto vira metadado. */
function cardColumns(showCost: boolean): ResponsiveColumn<AgentMetric>[] {
  const mono = 'font-mono tabular-nums';
  return [
    { id: 'period', card: 'primary', cell: (r) => <span className={mono}>{formatDate(r.periodStart)}</span> },
    ...(showCost
      ? [{ id: 'cost', card: 'badge' as const, cell: (r: AgentMetric) => <span className={mono}>{usd(r.totalCostUsd)}</span> }]
      : []),
    { id: 'tokens', card: 'meta', cell: (r) => <span className={mono}>{formatNumber(r.totalTokens)} tokens</span> },
    { id: 'conversations', card: 'meta', cell: (r) => <span className={mono}>{formatNumber(r.totalConversations)} conv.</span> },
    { id: 'messages', card: 'meta', cell: (r) => <span className={mono}>{formatNumber(r.totalMessages)} msg</span> },
    {
      id: 'errors',
      card: 'meta',
      cell: (r) => (
        <span className={cn(mono, r.errorCount > 0 ? 'text-danger' : 'text-text-low')}>
          {formatNumber(r.errorCount)} erros
        </span>
      ),
    },
    { id: 'latency', card: 'meta', cell: (r) => <span className={mono}>{latency(r)}</span> },
  ];
}

export function MetricsTab({ agentId, canViewCosts = false }: { agentId: string; canViewCosts?: boolean }) {
  const metrics = useAgentMetrics(agentId);
  const { isMobile } = useBreakpoint();
  const [period, setPeriod] = useState<MetricPeriod>('day');

  const rows = useMemo(
    () => (metrics.data ?? []).filter((m) => m.period === period),
    [metrics.data, period],
  );
  const summary = useMemo(() => summarize(rows), [rows]);

  if (metrics.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy aria-label="Carregando métricas">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-lg" />
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
          <Button variant="secondary" loading={metrics.isFetching} onClick={() => void metrics.refetch()}>
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
        description="Execuções, conversas e latência aparecem aqui assim que o agente começar a processar conversas."
      />
    );
  }

  const periodEmpty = {
    title: `Sem dados ${PERIOD_LABEL[period].toLowerCase()}s`,
    description: 'Não há métricas agregadas para este período. Tente outro intervalo.',
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Seletor de período: segmentado, largura total no celular (alvos ≥44px). */}
      <div
        role="group"
        aria-label="Período"
        className="flex w-full gap-1 rounded-md border border-border bg-surface-2 p-1 sm:inline-flex sm:w-auto sm:self-start"
      >
        {METRIC_PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={p === period}
            onClick={() => setPeriod(p)}
            className={cn(
              'min-h-11 flex-1 rounded-sm px-3 py-1.5 font-body text-sm font-bold outline-none sm:min-h-0 sm:flex-none',
              'transition-colors duration-(--dur-fast) ease-ds focus-visible:focus-ring motion-reduce:transition-none',
              p === period ? 'bg-surface text-text shadow-ds-1' : 'text-text-low hover:text-text',
            )}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={BarChart3} {...periodEmpty} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {canViewCosts ? <Stat label="Custo total" value={usd(summary.totalCostUsd)} /> : null}
            <Stat label="Tokens" value={formatNumber(summary.totalTokens)} />
            <Stat label="Conversas" value={formatNumber(summary.totalConversations)} />
            <Stat label="Mensagens" value={formatNumber(summary.totalMessages)} />
            {canViewCosts ? null : <Stat label="Handoffs" value={formatNumber(summary.handoffCount)} />}
          </dl>

          {isMobile ? (
            <ResponsiveTable
              rows={rows}
              columns={cardColumns(canViewCosts)}
              getRowId={metricRowId}
              ariaLabel="Métricas por período"
              empty={{ icon: BarChart3, ...periodEmpty }}
            />
          ) : (
            <DataTable<AgentMetric>
              caption="Métricas por período"
              columns={tableColumns(canViewCosts)}
              rows={rows}
              getRowId={metricRowId}
              density="compact"
              empty={<EmptyState icon={BarChart3} {...periodEmpty} />}
            />
          )}
        </>
      )}
    </div>
  );
}
