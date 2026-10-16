'use client';

/**
 * Hub de Tenants (F26-S07) no DS 3.0 (F72-S08) — lista buscável e paginada com plano,
 * status, membros e custo de IA do mês; clicar na linha abre o Workspace 360 (UX §2.1).
 *
 * Desktop: `DataTable` operacional (slug, números e datas em mono). Mobile: cards via
 * `ResponsiveTable` (filtro no bottom-sheet). Custo de IA é legítimo aqui: quem vê pode
 * agir sobre ele (DS3_ADOCAO §2.7).
 *
 * UX: §2.1 linha clicável; §2.5 `?` no título; §2.6 vazio distingue "sem tenants" de
 * "filtro sem resultado"; §2.7 skeleton no formato da tabela; §2.10 Tab/Enter/setas na
 * tabela; §2.11 erro em 3 partes com "Tentar de novo".
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, ChevronLeft, ChevronRight, Search, SearchX } from 'lucide-react';
import { Button, DataTable, EmptyState, ErrorState, type DataTableColumn } from '@hm/ui';
import { ResponsiveTable, type ResponsiveColumn } from '@/shared/components/ResponsiveTable';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { cn } from '@/shared/lib/cn';
import { formatDate, formatNumber } from '@/shared/lib/locale';
import { SUBSCRIPTION_STATUSES, subscriptionStatus, usd } from '../lib/labels';
import { PlatformPageHeader } from '../ui/PlatformPageHeader';
import { SubscriptionBadge } from '../ui/kit';
import { useTenants, type TenantListItem } from './queries';

const PAGE_SIZE = 25;
const TABLE_DATE: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };

const FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Todos' },
  ...SUBSCRIPTION_STATUSES.map((s) => ({ value: s, label: subscriptionStatus(s).label })),
];

export function TenantsList() {
  const router = useRouter();
  const { isMobile } = useBreakpoint();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);

  const query = useTenants({
    search: search.trim() || undefined,
    status: status || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const tenants = query.data?.tenants ?? [];
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isFiltering = status !== '' || search.trim() !== '';
  const open = (t: TenantListItem) => router.push(`/platform/tenants/${t.id}`);

  const clearFilters = () => {
    setStatus('');
    setSearch('');
    setPage(0);
  };

  // ── Desktop ────────────────────────────────────────────────────────────────
  const columns: DataTableColumn<TenantListItem>[] = [
    {
      id: 'tenant',
      header: 'Tenant',
      cell: (t) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-bold text-text">{t.name}</span>
          <span className="truncate font-mono text-xs text-text-low">{t.slug}</span>
        </span>
      ),
    },
    {
      id: 'plan',
      header: 'Plano',
      width: '11rem',
      cell: (t) => <span className="truncate text-text-mid">{t.planName ?? 'Sem plano'}</span>,
    },
    { id: 'status', header: 'Status', width: '9.5rem', cell: (t) => <SubscriptionBadge status={t.subscriptionStatus} size="sm" /> },
    {
      id: 'members',
      header: 'Membros',
      numeric: true,
      width: '7rem',
      cell: (t) => <span className="text-text-mid">{formatNumber(t.memberCount)}</span>,
    },
    {
      id: 'cost',
      header: 'Custo IA (mês)',
      numeric: true,
      width: '9rem',
      cell: (t) => <span className="text-text">{usd(t.monthCostUsd)}</span>,
    },
    {
      id: 'createdAt',
      header: 'Criado em',
      numeric: true,
      width: '8rem',
      cell: (t) => <span className="whitespace-nowrap text-text-mid">{formatDate(t.createdAt, TABLE_DATE)}</span>,
    },
  ];

  // ── Mobile ─────────────────────────────────────────────────────────────────
  const cardColumns: ResponsiveColumn<TenantListItem>[] = [
    { id: 'name', card: 'primary', cell: (t) => t.name },
    {
      id: 'plan',
      card: 'secondary',
      cell: (t) => (
        <span>
          {t.planName ?? 'Sem plano'} · <span className="font-mono">{t.slug}</span>
        </span>
      ),
    },
    { id: 'status', card: 'badge', cell: (t) => <SubscriptionBadge status={t.subscriptionStatus} size="sm" /> },
    {
      id: 'numbers',
      card: 'meta',
      cell: (t) => (
        <span className="whitespace-nowrap font-mono tabular-nums">
          {formatNumber(t.memberCount)} {t.memberCount === 1 ? 'membro' : 'membros'} · {usd(t.monthCostUsd)}
        </span>
      ),
    },
  ];

  const searchField = (
    <div className="relative w-full md:max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-low" aria-hidden />
      <input
        type="search"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
        placeholder="Buscar por nome ou slug"
        aria-label="Buscar tenant"
        className="h-10 w-full rounded-sm border border-border bg-surface-2 pl-9 pr-3 font-body text-base text-text outline-none transition-[border-color,box-shadow] duration-(--dur-base) ease-ds placeholder:text-text-low hover:border-border-2 focus:border-brand-text focus-visible:focus-ring sm:text-sm"
      />
    </div>
  );

  const filterControls = (
    <div role="group" aria-label="Filtrar por status" className="flex flex-wrap gap-1.5">
      {FILTERS.map((f) => {
        const active = status === f.value;
        return (
          <button
            key={f.value || 'all'}
            type="button"
            aria-pressed={active}
            onClick={() => {
              setStatus(f.value);
              setPage(0);
            }}
            className={cn(
              'h-11 rounded-pill border px-3 font-body text-sm font-medium outline-none md:h-8',
              'transition-colors duration-(--dur-fast) ease-ds focus-visible:focus-ring motion-reduce:transition-none',
              active
                ? 'border-brand-text/30 bg-brand-text/10 text-brand-text'
                : 'border-border bg-surface text-text-mid hover:border-border-2 hover:text-text',
            )}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );

  const retry = (
    <Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
      Tentar de novo
    </Button>
  );
  const errorCopy = {
    title: 'Não foi possível carregar os tenants',
    reason: 'A lista de workspaces da plataforma não respondeu.',
    whatToDo: 'Verifique a conexão e tente novamente.',
  };
  const noResults = {
    title: 'Nenhum tenant com estes filtros',
    description: 'Ajuste a busca ou o status, ou veja todos os workspaces.',
  };
  const firstUse = {
    title: 'Nenhum tenant ainda',
    description: 'Os workspaces aparecem aqui assim que alguém cria uma conta.',
  };

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const pager =
    total > PAGE_SIZE ? (
      <nav aria-label="Paginação de tenants" className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-body text-sm text-text-low">
          <span className="font-mono tabular-nums text-text-mid">
            {formatNumber(from)}–{formatNumber(to)}
          </span>{' '}
          de <span className="font-mono tabular-nums text-text-mid">{formatNumber(total)}</span>
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="max-md:h-11"
            disabled={page === 0}
            leftIcon={<ChevronLeft className="size-4" aria-hidden />}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Anterior
          </Button>
          <span className="font-mono text-sm tabular-nums text-text-low" aria-live="polite">
            {formatNumber(page + 1)}/{formatNumber(pageCount)}
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="max-md:h-11"
            disabled={page + 1 >= pageCount}
            rightIcon={<ChevronRight className="size-4" aria-hidden />}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      </nav>
    ) : null;

  const description = query.data ? (
    <span>
      <span className="font-mono tabular-nums text-text-mid">{formatNumber(total)}</span>{' '}
      {total === 1 ? 'workspace' : 'workspaces'}
      {isFiltering ? ' com estes filtros' : ' na plataforma'}
    </span>
  ) : (
    'Todos os workspaces da plataforma.'
  );

  return (
    <div className="flex flex-col">
      <PlatformPageHeader href="/platform/tenants" title="Tenants" description={description} />

      {isMobile ? (
        <div className="flex flex-col gap-3">
          <ResponsiveTable<TenantListItem>
            ariaLabel="Tenants"
            rows={tenants}
            columns={cardColumns}
            getRowId={(t) => t.id}
            onRowClick={open}
            rowLabel={(t) => `Abrir 360 de ${t.name}`}
            searchSlot={searchField}
            filters={filterControls}
            filtersTitle="Filtrar tenants"
            activeFilters={
              status
                ? [{ id: 'status', label: `Status: ${subscriptionStatus(status).label}`, onClear: () => setStatus('') }]
                : []
            }
            onClearFilters={isFiltering ? clearFilters : undefined}
            isLoading={query.isLoading}
            isError={query.isError}
            error={{ ...errorCopy, action: retry }}
            empty={{ icon: isFiltering ? SearchX : Building2, ...(isFiltering ? noResults : firstUse) }}
          />
          {pager}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {searchField}
            {filterControls}
          </div>
          <DataTable<TenantListItem>
            caption="Tenants"
            columns={columns}
            rows={tenants}
            getRowId={(t) => t.id}
            loading={query.isLoading}
            loadingRows={8}
            onRowClick={open}
            getRowLabel={(t) => `Abrir 360 de ${t.name}`}
            getRowState={(t) =>
              t.subscriptionStatus === 'past_due'
                ? 'attention'
                : t.subscriptionStatus === 'canceled' || t.subscriptionStatus === 'expired'
                  ? 'muted'
                  : undefined
            }
            error={query.isError ? <ErrorState {...errorCopy} action={retry} /> : undefined}
            empty={
              isFiltering ? (
                <EmptyState
                  variant="no-results"
                  icon={SearchX}
                  {...noResults}
                  secondaryAction={
                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                      Limpar filtros
                    </Button>
                  }
                />
              ) : (
                <EmptyState icon={Building2} {...firstUse} />
              )
            }
          />
          {pager}
        </div>
      )}
    </div>
  );
}
