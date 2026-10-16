'use client';

/**
 * Uso e custo de LLM (F25-S08) no DS 3.0 (F72-S08) — gasto por workspace/modelo/dia,
 * maiores gastos do mês e alertas de teto. Aqui o custo de IA é legítimo: quem vê pode
 * agir (políticas, teto, conversa com o tenant) — DS3_ADOCAO §2.7.
 *
 * Hierarquia: alertas de teto (só quando existem) → KPIs do período em mono (somados dos
 * mesmos buckets do gráfico, sem chamada nova) → gráfico (barras em `brand-text` a 40%,
 * 100% no hover) → maiores gastos em `DataTable` (linha abre o 360 do tenant).
 *
 * UX: §2.1 linha clicável; §2.5 `?`; §2.7 skeleton no formato; §2.11 erro em 3 partes.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Coins, Cpu, Send, TrendingUp } from 'lucide-react';
import { Button, DataTable, EmptyState, ErrorState, Skeleton, type DataTableColumn } from '@hm/ui';
import { lazyClient } from '@/shared/lib/lazy';
import { cn } from '@/shared/lib/cn';
import { formatNumber, formatPercent } from '@/shared/lib/locale';
import type { CapAlert, TopSpender, UsageGroupBy } from '@/features/platform-admin/lib';
import { usd } from '../lib/labels';
import { PlatformPageHeader } from '../ui/PlatformPageHeader';
import { Kpi, Panel } from '../ui/kit';
import { useCapAlerts, useTopSpenders, useUsageSummary } from './queries';

const LazyUsageChart = lazyClient(() => import('./UsageChart'), {
  loading: () => <Skeleton className="h-64 w-full rounded-md" />,
});

const GROUPS: { value: UsageGroupBy; label: string }[] = [
  { value: 'day', label: 'Por dia' },
  { value: 'workspace', label: 'Por workspace' },
  { value: 'model', label: 'Por modelo' },
];

function CapAlertsBanner() {
  const { data } = useCapAlerts();
  const router = useRouter();
  if (!data || data.alerts.length === 0) return null;
  const n = data.alerts.length;
  return (
    <section aria-labelledby="usage-cap-alerts" className="rounded-lg border border-warn/40 bg-warn/10">
      <h2
        id="usage-cap-alerts"
        className="flex items-center gap-2 border-b border-warn/20 px-5 py-3 font-head text-sm font-semibold text-text"
      >
        <AlertTriangle className="size-4 text-warn" aria-hidden />
        <span className="font-mono tabular-nums">{formatNumber(n)}</span>
        {n === 1 ? 'workspace perto do teto mensal' : 'workspaces perto do teto mensal'}
      </h2>
      <ul className="divide-y divide-warn/20">
        {data.alerts.map((a: CapAlert) => {
          const over = a.pctOfCap >= 1;
          return (
            <li key={a.workspaceId}>
              <button
                type="button"
                onClick={() => router.push(`/platform/tenants/${a.workspaceId}`)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-5 py-3 text-left outline-none transition-colors duration-(--dur-fast) hover:bg-warn/5 focus-visible:focus-ring sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
              >
                <span className="truncate font-body text-sm font-semibold text-text">{a.workspaceName}</span>
                <span aria-hidden className="order-last col-span-2 block h-1 overflow-hidden rounded-pill bg-surface-3 sm:order-none sm:col-span-1">
                  <span
                    className={cn('block h-full rounded-pill', over ? 'bg-danger' : 'bg-warn')}
                    style={{ width: `${Math.min(1, a.pctOfCap) * 100}%` }}
                  />
                </span>
                <span className="whitespace-nowrap text-right font-mono text-sm tabular-nums text-text-mid">
                  {usd(a.monthCostUsd)} / {usd(a.capUsd)}{' '}
                  <span className={over ? 'text-danger' : 'text-warn'}>{formatPercent(a.pctOfCap)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TopSpenders() {
  const router = useRouter();
  const query = useTopSpenders();
  const spenders = query.data?.spenders ?? [];

  const columns: DataTableColumn<TopSpender>[] = [
    {
      id: 'rank',
      header: '#',
      numeric: true,
      width: '3.5rem',
      cell: (s) => <span className="text-text-low">{formatNumber(spenders.indexOf(s) + 1)}</span>,
    },
    { id: 'name', header: 'Workspace', cell: (s) => <span className="truncate font-bold text-text">{s.workspaceName}</span> },
    {
      id: 'tokens',
      header: 'Tokens',
      numeric: true,
      width: '9rem',
      cell: (s) => <span className="text-text-mid">{formatNumber(s.totalTokens)}</span>,
    },
    {
      id: 'cost',
      header: 'Custo (mês)',
      numeric: true,
      width: '9rem',
      cell: (s) => <span className="text-text">{usd(s.costUsd)}</span>,
    },
  ];

  return (
    <Panel title="Maiores gastos do mês" titleId="usage-top" icon={TrendingUp} body="flush">
      <DataTable<TopSpender>
        caption="Maiores gastos do mês"
        columns={columns}
        rows={spenders}
        getRowId={(s) => s.workspaceId}
        density="compact"
        loading={query.isLoading}
        loadingRows={5}
        onRowClick={(s) => router.push(`/platform/tenants/${s.workspaceId}`)}
        getRowLabel={(s) => `Abrir 360 de ${s.workspaceName}`}
        error={
          query.isError ? (
            <ErrorState
              title="Não foi possível carregar os maiores gastos"
              reason="O ranking do mês não respondeu."
              whatToDo="Tente de novo em instantes."
              action={
                <Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
                  Tentar de novo
                </Button>
              }
            />
          ) : undefined
        }
        empty={<EmptyState className="py-8" icon={TrendingUp} title="Sem gasto no mês" description="Nenhum workspace usou IA neste mês." />}
        className="rounded-t-none rounded-b-[calc(var(--radius-lg)-1px)] border-0"
      />
    </Panel>
  );
}

export function UsageDashboard() {
  const [groupBy, setGroupBy] = useState<UsageGroupBy>('day');
  const query = useUsageSummary(groupBy);
  const buckets = query.data?.buckets ?? [];
  const totals = buckets.reduce(
    (acc, b) => ({ cost: acc.cost + b.costUsd, tokens: acc.tokens + b.totalTokens, requests: acc.requests + b.requests }),
    { cost: 0, tokens: 0, requests: 0 },
  );

  return (
    <div className="flex flex-col">
      <PlatformPageHeader
        href="/platform/usage"
        title="Uso e custo de IA"
        description="Gasto agregado de todos os workspaces, cruzado com os tetos das políticas."
        help={<p>Valores em dólar, como a OpenRouter cobra. Execuções de teste do Playground não entram.</p>}
      />

      <div className="flex flex-col gap-4">
        <CapAlertsBanner />

        <section aria-label="Totais do período" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {query.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)
          ) : (
            <>
              <Kpi label="Gasto no período" icon={Coins} value={query.isError ? '—' : usd(totals.cost)} />
              <Kpi label="Tokens" icon={Cpu} value={query.isError ? '—' : formatNumber(totals.tokens)} />
              <Kpi label="Requisições" icon={Send} value={query.isError ? '—' : formatNumber(totals.requests)} />
            </>
          )}
        </section>

        <Panel
          title="Gasto (USD)"
          titleId="usage-chart"
          action={
            <div role="group" aria-label="Agrupar por" className="flex rounded-sm border border-border bg-surface-2 p-0.5">
              {GROUPS.map((g) => {
                const active = groupBy === g.value;
                return (
                  <button
                    key={g.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setGroupBy(g.value)}
                    className={cn(
                      'h-9 rounded-xs px-3 font-body text-sm font-medium outline-none transition-colors duration-(--dur-fast) focus-visible:focus-ring md:h-7',
                      active ? 'bg-surface text-text shadow-ds-1' : 'text-text-mid hover:text-text',
                    )}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          }
        >
          {query.isLoading ? (
            <Skeleton className="h-64 w-full rounded-md" />
          ) : query.isError ? (
            <ErrorState
              title="Não foi possível carregar o uso"
              reason="O resumo de custo não respondeu."
              whatToDo="Tente de novo em instantes."
              action={
                <Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
                  Tentar de novo
                </Button>
              }
            />
          ) : (
            <LazyUsageChart buckets={buckets} />
          )}
        </Panel>

        <TopSpenders />
      </div>
    </div>
  );
}
