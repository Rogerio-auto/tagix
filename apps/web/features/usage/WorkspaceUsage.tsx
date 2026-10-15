'use client';

/**
 * Uso e custo de IA do WORKSPACE (DASHBOARD.md §319; DS 3.0 na F72-S07). Destino de drill
 * dos cards "Custo IA hoje" / "Custo IA no mês" / "Cap mensal consumido" — daí ler
 * `?period=today|mes` da URL como período inicial. KPIs (hoje × mês) em mono tabular +
 * gráfico por dia/modelo. Gráfico (recharts) via lazy boundary — reusa o de plataforma
 * (mesma forma de bucket). Só leitura de dados: nenhum botão de escrita.
 *
 * Moeda: o custo de LLM é cobrado em dólar (`costUsd` no contrato), então a moeda vem do
 * próprio dado; o idioma da formatação é o da interface (`@/shared/lib/locale`).
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AnchoredHelpHint, Button, ErrorState } from '@hm/ui';
import { lazyClient } from '@/shared/lib/lazy';
import { cn } from '@/shared/lib/cn';
import { Skeleton } from '@/shared/components/feedback';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { formatMoneyUnits, formatNumber } from '@/shared/lib/locale';
import { useWorkspaceUsageSummary, useWorkspaceUsageTotals } from './queries';
import type { UsageGroupBy } from './client';

const LazyUsageChart = lazyClient(() => import('@/features/platform-admin/usage/UsageChart'), {
  loading: () => <Skeleton className="h-56 w-full" />,
});

/** Moeda do contrato de uso (`costUsd`). */
const COST_CURRENCY = 'USD';

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
  formatMoneyUnits(n, COST_CURRENCY, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function KpiTile({ label, value, hint }: { label: string; value: string; hint: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface px-5 py-4">
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-text-low">{label}</p>
      <p className="truncate font-mono text-h4 font-medium tabular-nums tracking-tight text-text md:text-h3">
        {value}
      </p>
      <p className="font-body text-sm text-text-low">{hint}</p>
    </div>
  );
}

/** Segmentado (botões com `aria-pressed`): um grupo por eixo do gráfico. */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-sm border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-8 rounded-xs px-3 font-body text-xs font-bold outline-none',
            'transition-colors duration-(--dur-fast) ease-ds focus-visible:focus-ring',
            value === o.value ? 'bg-surface text-text shadow-ds-1' : 'text-text-mid hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
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

  const requests = (n: number | undefined) => (
    <>
      <span className="font-mono tabular-nums text-text-mid">{formatNumber(n ?? 0)}</span>{' '}
      {(n ?? 0) === 1 ? 'requisição' : 'requisições'}
    </>
  );

  return (
    <section className="flex flex-col">
      <PageHeader
        title="Uso e custo de IA"
        description="Gasto com os agentes de IA deste workspace. Não inclui testes do playground."
        helpSlot={<AnchoredHelpHint anchorKey="settings.usage" />}
      />

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-busy={totals.isLoading || undefined}>
          {totals.isLoading ? (
            <>
              <Skeleton className="h-28 w-full rounded-lg" />
              <Skeleton className="h-28 w-full rounded-lg" />
              <Skeleton className="h-28 w-full rounded-lg" />
            </>
          ) : totals.isError ? (
            <div className="rounded-lg border border-border bg-surface sm:col-span-3">
              <ErrorState
                title="Não foi possível carregar os totais"
                reason="O resumo de custo não respondeu."
                whatToDo="Tente de novo em instantes."
                action={
                  <Button variant="secondary" size="sm" onClick={() => void totals.refetch()}>
                    Tentar de novo
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              <KpiTile label="Custo hoje" value={money(today?.costUsd ?? 0)} hint={requests(today?.requests)} />
              <KpiTile label="Custo no mês" value={money(month?.costUsd ?? 0)} hint={requests(month?.requests)} />
              <KpiTile
                label="Tokens no mês"
                value={formatNumber(month?.totalTokens ?? 0)}
                hint="prompt + completion"
              />
            </>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-mono text-xs font-medium uppercase tracking-widest text-text-low">
              Gasto <span className="normal-case tracking-normal">({COST_CURRENCY})</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              <Segmented label="Período" options={PERIODS} value={period} onChange={setPeriod} />
              <Segmented label="Agrupar" options={GROUPS} value={groupBy} onChange={setGroupBy} />
            </div>
          </div>
          {summary.isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : summary.isError ? (
            <ErrorState
              title="Não foi possível carregar o gráfico"
              reason="A série de custo deste período não respondeu."
              whatToDo="Tente de novo ou troque o período."
              action={
                <Button variant="secondary" size="sm" onClick={() => void summary.refetch()}>
                  Tentar de novo
                </Button>
              }
            />
          ) : (
            <LazyUsageChart buckets={summary.data?.buckets ?? []} />
          )}
        </div>
      </div>
    </section>
  );
}
