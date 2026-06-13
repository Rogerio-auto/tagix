'use client';

/**
 * LlmUsageDashboard (F25-S08) — gasto LLM por workspace/modelo/dia, top spenders e
 * alertas de cap. O grafico (recharts) vem via lazy boundary com skeleton (§3.6, nao
 * regredir bundle). Banner de cap-alerts no topo. Consome F25-S05. DS v2 dark-first.
 */
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { lazyClient } from '@/shared/lib/lazy';
import { Skeleton } from '@/shared/components/feedback';
import type { UsageGroupBy } from '@/features/platform-admin/lib';
import { useCapAlerts, useTopSpenders, useUsageSummary } from './queries';

const LazyUsageChart = lazyClient(() => import('./UsageChart'), {
  loading: () => <Skeleton className="h-56 w-full" />,
});

const GROUPS: { value: UsageGroupBy; label: string }[] = [
  { value: 'day', label: 'Por dia' },
  { value: 'workspace', label: 'Por workspace' },
  { value: 'model', label: 'Por modelo' },
];

function CapAlertsBanner() {
  const { data } = useCapAlerts();
  if (!data || data.alerts.length === 0) return null;
  return (
    <div className="rounded-lg border border-warn/40 bg-warn/10 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-warn">
        <AlertTriangle className="size-4" aria-hidden />
        {data.alerts.length} workspace(s) perto do teto mensal
      </div>
      <ul className="flex flex-col gap-1 text-sm text-text-mid">
        {data.alerts.map((a) => (
          <li key={a.workspaceId} className="flex items-center justify-between gap-3">
            <span className="truncate">{a.workspaceName}</span>
            <span className="font-mono text-xs">
              ${a.monthCostUsd.toFixed(2)} / ${a.capUsd.toFixed(2)} ({Math.round(a.pctOfCap * 100)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TopSpenders() {
  const { data, isLoading } = useTopSpenders();
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <h3 className="mb-3 font-head text-sm font-semibold uppercase tracking-wide text-text-low">
        Top spenders (mes)
      </h3>
      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {(data?.spenders ?? []).map((s) => (
            <li key={s.workspaceId} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="truncate text-text">{s.workspaceName}</span>
              <span className="font-mono text-text-mid">${s.costUsd.toFixed(2)}</span>
            </li>
          ))}
          {(data?.spenders ?? []).length === 0 && (
            <li className="py-3 text-sm text-text-low">Sem gasto no mes.</li>
          )}
        </ul>
      )}
    </div>
  );
}

export function UsageDashboard() {
  const [groupBy, setGroupBy] = useState<UsageGroupBy>('day');
  const { data, isLoading } = useUsageSummary(groupBy);

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h1 className="font-head text-xl font-semibold text-text">Uso e custo LLM</h1>
        <p className="mt-1 text-sm text-text-mid">
          Gasto agregado de todos os workspaces. Cruzado com os tetos de custo das politicas.
        </p>
      </header>

      <CapAlertsBanner />

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-head text-sm font-semibold uppercase tracking-wide text-text-low">
            Gasto (USD)
          </h3>
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
        {isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <LazyUsageChart buckets={data?.buckets ?? []} />
        )}
      </div>

      <TopSpenders />
    </section>
  );
}
