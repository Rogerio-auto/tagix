'use client';

/**
 * Hub de Tenants (F26-S07) — lista buscavel/paginavel com plano, status, #membros e
 * custo-mes; clicar leva ao Workspace 360 (UX §3.1: selecionar antes de agir). Consome
 * F26-S02. DS v2 dark-first (tokens semanticos, zero hex); skeleton no loading (§3.6).
 * Mobile (F36-S13): tabela→cards + filtros em sheet via `ResponsiveTable`.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Search } from 'lucide-react';
import { ResponsiveTable, type ResponsiveColumn } from '@/shared/components/ResponsiveTable';
import { useTenants, type TenantListItem } from './queries';

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
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);

  const { data, isLoading, isError } = useTenants({
    search: search.trim() || undefined,
    status: status || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const statusLabel = STATUS_OPTIONS.find((o) => o.value === status)?.label;

  const columns: ResponsiveColumn<TenantListItem>[] = [
    {
      id: 'tenant',
      header: 'Tenant',
      card: 'primary',
      cell: (t) => (
        <span className="flex flex-col">
          <span className="font-medium text-text-high">{t.name}</span>
          <span className="text-xs text-text-low">{t.slug}</span>
        </span>
      ),
    },
    {
      id: 'plan',
      header: 'Plano',
      className: 'text-text-mid',
      cell: (t) => t.planName ?? '—',
    },
    {
      id: 'status',
      header: 'Status',
      card: 'badge',
      cell: (t) => <StatusPill status={t.subscriptionStatus} />,
    },
    {
      id: 'members',
      header: 'Membros',
      align: 'right',
      className: 'text-right font-mono text-text-mid',
      cell: (t) => `${t.memberCount} membro(s)`,
    },
    {
      id: 'cost',
      header: 'Custo (mês)',
      align: 'right',
      className: 'text-right font-mono text-text-mid',
      cell: (t) => `$${t.monthCostUsd.toFixed(2)}`,
    },
  ];

  const filters = (
    <select
      value={status}
      onChange={(e) => {
        setStatus(e.target.value);
        setPage(0);
      }}
      aria-label="Filtrar por status"
      className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text-high focus:border-accent focus:outline-none"
    >
      {STATUS_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  const searchSlot = (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-low"
        aria-hidden
      />
      <input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
        placeholder="Buscar por nome ou slug…"
        aria-label="Buscar tenant"
        className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm text-text-high placeholder:text-text-low focus:border-accent focus:outline-none"
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-text-high">Tenants</h1>
        <p className="text-sm text-text-mid">
          Todos os workspaces da plataforma. Clique para abrir o 360 do tenant.
        </p>
      </header>

      <ResponsiveTable
        ariaLabel="Tenants"
        rows={data?.tenants ?? []}
        columns={columns}
        getRowId={(t) => t.id}
        onRowClick={(t) => router.push(`/platform/tenants/${t.id}`)}
        rowLabel={(t) => `Abrir 360 de ${t.name}`}
        searchSlot={searchSlot}
        filters={filters}
        filtersTitle="Filtrar tenants"
        activeFilters={
          status
            ? [{ id: 'status', label: `Status: ${statusLabel}`, onClear: () => setStatus('') }]
            : []
        }
        onClearFilters={() => setStatus('')}
        isLoading={isLoading}
        isError={isError}
        empty={{
          icon: Building2,
          title: 'Nenhum tenant encontrado',
          description: 'Ajuste a busca ou o filtro de status.',
        }}
        error={{
          title: 'Não foi possível carregar os tenants',
          whatToDo: 'Tente novamente em instantes.',
        }}
        footer={
          total > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-mid">
              <span>
                {total} tenant(s) · página {page + 1} de {pageCount}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="touch-target rounded-lg border border-border px-3 py-1.5 text-text-high disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((p) => p + 1)}
                  className="touch-target rounded-lg border border-border px-3 py-1.5 text-text-high disabled:opacity-40"
                >
                  Próxima
                </button>
              </div>
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
