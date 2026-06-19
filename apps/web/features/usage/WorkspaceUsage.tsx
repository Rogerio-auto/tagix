'use client';

/**
 * Página de uso e custo de IA do WORKSPACE (DASHBOARD.md §319). Destino de drill dos
 * cards "Custo IA hoje" / "Custo IA no mês" / "Cap mensal consumido" — daí ler
 * `?period=today|mes` da URL como período inicial. KPIs (hoje × mês) + gráfico por
 * dia/modelo. Gráfico (recharts) via lazy boundary — reusa o de plataforma (mesma
 * forma de bucket). DS v2 dark-first, zero hex.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { lazyClient } from '@/shared/lib/lazy';
import { Skeleton } from '@/shared/components/feedback';
import { useWorkspaceUsageSummary, useWorkspaceUsageTotals } from './queries';
import type { UsageGroupBy } from './client';

const LazyUsageChart = lazyClient(() => import('@/features/platform-admin/usage/UsageChart'), {
  loading: () => <Skeleton className="h-56 w-full" />,
});

const PERIODS = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'mes', label: 'Mês' },
] as const;
type PeriodValue = (typeof PERIODS)[number]['value'];

const GROUPS: { value: UsageGroupBy; label: string }[] = [
  { value: 'day', label: 'Por dia' },
  { value: 'model', label: 'Por modelo' },
];

function isPeriod(v: string | null): v is PeriodValue {
  return v === 'today' || v === '7d' || v === '30d' || v === 'mes';
}

/** ISO (UTC) do início da janela do período — passado como `from` ao backend. */
function periodFrom(p: PeriodValue): string {
  const now = new Date();
  if (p === 'today') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  }
  if (p === 'mes') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  }
  const days = p === '7d' ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

const money = (n: number): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function KpiTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <p className="font-head text-xs font-semibold uppercase tracking-wide text-text-low">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold text-text">{value}</p>
      {hint && <p className="mt-1 text-xs text-text-low">{hint}</p>}
    </div>
  );
}

export function WorkspaceUsage() {
  const params = useSearchParams();
  const initial = params.get('period');

  const [period, setPeriod] = useState<PeriodValue>(isPeriod(initial) ? initial : '30d');
  const [groupBy, setGroupBy] = useState<UsageGroupBy>('day');

  const from = useMemo(() => periodFrom(period), [period]);
  const summary = useWorkspaceUsageSummary(groupBy, from);
  const totals = useWorkspaceUsageTotals();

  const today = totals.data?.today;
  const month = totals.data?.month;

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h1 className="font-head text-xl font-semibold text-text">Uso e custo de IA</h1>
        <p className="mt-1 text-sm text-text-mid">
          Gasto com os agentes de IA deste workspace. Não inclui testes do playground.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {totals.isLoading ? (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : (
          <>
            <KpiTile label="Custo hoje" value={money(today?.costUsd ?? 0)} hint={`${today?.requests ?? 0} requisições`} />
            <KpiTile label="Custo no mês" value={money(month?.costUsd ?? 0)} hint={`${month?.requests ?? 0} requisições`} />
            <KpiTile
              label="Tokens no mês"
              value={(month?.totalTokens ?? 0).toLocaleString('pt-BR')}
              hint="prompt + completion"
            />
          </>
        )}
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-head text-sm font-semibold uppercase tracking-wide text-text-low">
            Gasto (USD)
          </h3>
          <div className="flex flex-wrap gap-2">
            <div className="flex gap-1 rounded-md border border-border p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPeriod(p.value)}
                  className={
                    period === p.value
                      ? 'rounded-sm bg-surface-3 px-3 py-1 text-xs font-medium text-text'
                      : 'rounded-sm px-3 py-1 text-xs font-medium text-text-mid hover:text-text'
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1 rounded-md border border-border p-0.5">
              {GROUPS.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGroupBy(g.value)}
                  className={
                    groupBy === g.value
                      ? 'rounded-sm bg-surface-3 px-3 py-1 text-xs font-medium text-text'
                      : 'rounded-sm px-3 py-1 text-xs font-medium text-text-mid hover:text-text'
                  }
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {summary.isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <LazyUsageChart buckets={summary.data?.buckets ?? []} />
        )}
      </div>
    </section>
  );
}
