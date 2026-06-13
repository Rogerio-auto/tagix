'use client';

/**
 * Hub de Tenants (F26-S07) — lista buscavel/paginavel com plano, status, #membros e
 * custo-mes; clicar leva ao Workspace 360 (UX §3.1: selecionar antes de agir). Consome
 * F26-S02. DS v2 dark-first (tokens semanticos, zero hex); skeleton no loading (§3.6).
 */
import { useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { Skeleton } from '@/shared/components/feedback';
import { useTenants } from './queries';

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'trial', label: 'Trial' },
  { value: 'active', label: 'Ativo' },
  { value: 'past_due', label: 'Inadimplente' },
  { value: 'canceled', label: 'Cancelado' },
  { value: 'expired', label: 'Expirado' },
] as const;

const STATUS_TONE: Record<string, string> = {
  trial: 'bg-info/15 text-info',
  active: 'bg-ok/15 text-ok',
  past_due: 'bg-warn/15 text-warn',
  canceled: 'bg-surface-3 text-text-mid',
  expired: 'bg-danger/15 text-danger',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status] ?? 'bg-surface-3 text-text-mid'}`}
    >
      {status}
    </span>
  );
}

export function TenantsList() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);

  const { data, isLoading } = useTenants({
    search: search.trim() || undefined,
    status: status || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-text-high">Tenants</h1>
        <p className="text-sm text-text-mid">
          Todos os workspaces da plataforma. Clique para abrir o 360 do tenant.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-low" aria-hidden />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Buscar por nome ou slug…"
            className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm text-text-high placeholder:text-text-low focus:border-accent focus:outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text-high focus:border-accent focus:outline-none"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-text-low">
            <tr>
              <th className="px-4 py-3 font-medium">Tenant</th>
              <th className="px-4 py-3 font-medium">Plano</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Membros</th>
              <th className="px-4 py-3 font-medium text-right">Custo (mês)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <td className="px-4 py-3" colSpan={5}>
                    <Skeleton className="h-5 w-full" />
                  </td>
                </tr>
              ))
            ) : data && data.tenants.length > 0 ? (
              data.tenants.map((t) => (
                <tr key={t.id} className="transition-colors hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <Link href={`/platform/tenants/${t.id}`} className="flex flex-col">
                      <span className="font-medium text-text-high hover:text-accent">{t.name}</span>
                      <span className="text-xs text-text-low">{t.slug}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-text-mid">{t.planName ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={t.subscriptionStatus} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-text-mid">{t.memberCount}</td>
                  <td className="px-4 py-3 text-right font-mono text-text-mid">
                    ${t.monthCostUsd.toFixed(2)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-8 text-center text-text-low" colSpan={5}>
                  Nenhum tenant encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-text-mid">
        <span>
          {total} tenant(s) · página {page + 1} de {pageCount}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-lg border border-border px-3 py-1.5 text-text-high disabled:opacity-40"
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-border px-3 py-1.5 text-text-high disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}
