'use client';

/**
 * Catálogo de produtos em Settings (F47-S05, /settings/products; DS 3.0 na F72-S07).
 *
 * Lista (busca por nome/SKU + filtro ativo + paginação), criar/editar no Drawer (sheet no
 * mobile — UX §2.3) e arquivar (soft-delete com confirmação simples — UX §2.9). Desktop:
 * `DataTable` operacional, preço em mono à direita. Mobile: `ResponsiveTable` (cards).
 * Três estados explícitos (vazio/carregando/erro — UX §2.6/§2.7/§2.11). Verde-neon só no
 * CTA primário. Só leitura: criar, salvar e arquivar ficam `aria-disabled` com a explicação.
 *
 * §2.1: a ação primária de cada linha é o clique no corpo (abre edição) — arquivar é uma
 * ação secundária isolada (não propaga). §2.10: `Cmd/Ctrl+K` foca a busca; `Esc` limpa.
 */
import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Archive, Package, Plus, Search, SearchX } from 'lucide-react';
import {
  AnchoredHelpHint,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  StatusPill,
  useToast,
  type DataTableColumn,
} from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import {
  ResponsiveTable,
  type ResponsiveColumn,
} from '@/shared/components/ResponsiveTable';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { ApiError } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/cn';
import { formatNumber } from '@/shared/lib/locale';
import { useDeleteProduct, useProducts } from './queries';
import { ResponsivePanel } from './ResponsivePanel';
import { ProductForm } from './ProductForm';
import { formatCents } from './money';
import type { Product } from './types';

const PAGE_SIZE = 20;

type ActiveFilter = 'all' | 'active' | 'inactive';

const FILTER_OPTIONS: ReadonlyArray<{ id: ActiveFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'active', label: 'Ativos' },
  { id: 'inactive', label: 'Inativos' },
];

function activeFilterToParam(filter: ActiveFilter): boolean | undefined {
  if (filter === 'active') return true;
  if (filter === 'inactive') return false;
  return undefined;
}

function ProductStatus({ product }: { product: Product }): React.JSX.Element {
  return product.active ? (
    <StatusPill tone="success" size="sm">
      Ativo
    </StatusPill>
  ) : (
    <StatusPill tone="neutral" size="sm">
      Inativo
    </StatusPill>
  );
}

export function ProductsCatalog(): React.JSX.Element {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const searchRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ActiveFilter>('all');
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);

  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Product | undefined>(undefined);
  const [toArchive, setToArchive] = useState<Product | null>(null);

  const remove = useDeleteProduct();

  const productsQuery = useProducts({
    q: deferredQuery,
    active: activeFilterToParam(filter),
    page,
    pageSize: PAGE_SIZE,
  });

  // Cmd/Ctrl+K foca a busca; Esc limpa quando focada (UX §2.10).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const openCreate = useCallback(() => {
    setEditing(undefined);
    setPanelOpen(true);
  }, []);

  const openEdit = useCallback((product: Product) => {
    setEditing(product);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setEditing(undefined);
  }, []);

  function confirmArchive(): void {
    if (!toArchive) return;
    remove.mutate(toArchive.id, {
      onSuccess: () => {
        toast({ variant: 'success', title: 'Produto arquivado' });
        setToArchive(null);
      },
      onError: (err) =>
        toast({ variant: 'error', title: 'Falha ao arquivar', description: err.message }),
    });
  }

  const data = productsQuery.data;
  const products = data?.products ?? [];
  const totalPages = data?.totalPages ?? 1;
  const isFiltering = query.trim().length > 0 || filter !== 'all';

  const clearFilters = (): void => {
    setQuery('');
    setFilter('all');
    setPage(1);
  };

  const createButton = (label: string): React.JSX.Element => (
    <ReadOnlyGuard>
      <Button variant="primary" leftIcon={<Plus className="size-4" aria-hidden />} onClick={openCreate}>
        {label}
      </Button>
    </ReadOnlyGuard>
  );

  const archiveButton = (product: Product): React.JSX.Element => (
    <ReadOnlyGuard>
      <IconButton
        variant="danger"
        size="sm"
        aria-label={`Arquivar ${product.name}`}
        icon={<Archive aria-hidden />}
        onClick={(e) => {
          e.stopPropagation();
          setToArchive(product);
        }}
      />
    </ReadOnlyGuard>
  );

  const tableColumns: DataTableColumn<Product>[] = [
    {
      id: 'name',
      header: 'Produto',
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-sm border',
              p.active
                ? 'border-brand-text/25 bg-brand-text/10 text-brand-text'
                : 'border-border bg-surface-2 text-text-low',
            )}
          >
            <Package className="size-4" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-bold text-text">{p.name}</span>
            <span className="truncate font-mono text-xs text-text-low">{p.sku ?? 'Sem SKU'}</span>
          </span>
        </span>
      ),
    },
    { id: 'status', header: 'Status', width: '8rem', cell: (p) => <ProductStatus product={p} /> },
    {
      id: 'price',
      header: 'Preço',
      numeric: true,
      width: '10rem',
      cell: (p) => formatCents(p.priceCents, p.currency),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Ações</span>,
      headerLabel: 'Ações',
      align: 'right',
      width: '4.5rem',
      cell: (p) => archiveButton(p),
    },
  ];

  const cardColumns: ResponsiveColumn<Product>[] = [
    {
      id: 'icon',
      card: 'avatar',
      cell: (p) => (
        <span
          aria-hidden
          className={cn(
            'grid size-10 place-items-center rounded-sm border',
            p.active
              ? 'border-brand-text/25 bg-brand-text/10 text-brand-text'
              : 'border-border bg-surface-2 text-text-low',
          )}
        >
          <Package className="size-5" />
        </span>
      ),
    },
    { id: 'name', card: 'primary', cell: (p) => p.name },
    {
      id: 'sku',
      card: 'secondary',
      cell: (p) => <span className="font-mono">{p.sku ?? 'Sem SKU'}</span>,
    },
    {
      id: 'price',
      card: 'meta',
      cell: (p) => (
        <span className="font-mono font-semibold tabular-nums text-text">
          {formatCents(p.priceCents, p.currency)}
        </span>
      ),
    },
    { id: 'status', card: 'badge', cell: (p) => <ProductStatus product={p} /> },
  ];

  const errorCopy = {
    title: 'Não foi possível carregar o catálogo',
    reason:
      productsQuery.error instanceof ApiError
        ? productsQuery.error.message
        : 'Houve uma falha de comunicação com o servidor.',
    whatToDo: 'Verifique sua conexão e tente novamente.',
    reference: productsQuery.error instanceof ApiError ? productsQuery.error.ref : undefined,
    action: (
      <Button variant="secondary" size="sm" onClick={() => void productsQuery.refetch()}>
        Tentar de novo
      </Button>
    ),
  };

  const emptyFirstRun = {
    icon: Package,
    title: 'Nenhum produto ainda',
    description:
      'Cadastre os produtos e serviços do seu workspace para vinculá-los aos cards e compor o valor de cada negócio.',
  };
  const emptyNoResults = {
    icon: SearchX,
    title: 'Nenhum produto encontrado',
    description: 'Nenhum produto bate com a busca ou o filtro atual. Ajuste os termos e tente de novo.',
  };

  const pagination =
    totalPages > 1 ? (
      <nav aria-label="Paginação" className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs tabular-nums text-text-low">
          Página {formatNumber(data?.page ?? page)} de {formatNumber(totalPages)}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={(data?.page ?? page) <= 1 || productsQuery.isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={(data?.page ?? page) >= totalPages || productsQuery.isFetching}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Próxima
          </Button>
        </div>
      </nav>
    ) : null;

  const total = data?.total;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Produtos"
        description={
          total === undefined ? (
            'Catálogo do workspace. Vincule produtos aos cards para compor o valor do negócio.'
          ) : (
            <span>
              <span className="font-mono tabular-nums text-text-mid">{formatNumber(total)}</span>{' '}
              {total === 1 ? 'produto' : 'produtos'} no catálogo · vincule aos cards para compor o
              valor do negócio
            </span>
          )
        }
        helpSlot={<AnchoredHelpHint anchorKey="settings.products" />}
        actions={createButton('Novo produto')}
      />

      <div className="flex flex-col gap-3">
        {/* Busca + filtro */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-text-low"
              aria-hidden
            />
            <Input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Buscar por nome ou SKU…"
              aria-label="Buscar produtos"
              aria-keyshortcuts="Control+K Meta+K"
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.preventDefault();
                  setQuery('');
                  setPage(1);
                }
              }}
              className="pl-9"
            />
          </div>
          <div
            role="group"
            aria-label="Filtrar por status"
            className="flex shrink-0 rounded-sm border border-border bg-surface-2 p-0.5"
          >
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={filter === opt.id}
                onClick={() => {
                  setFilter(opt.id);
                  setPage(1);
                }}
                className={cn(
                  'h-9 flex-1 rounded-xs px-3.5 font-body text-sm font-bold outline-none sm:flex-none',
                  'transition-colors duration-(--dur-fast) ease-ds focus-visible:focus-ring',
                  filter === opt.id
                    ? 'bg-surface text-text shadow-ds-1'
                    : 'text-text-mid hover:text-text',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {isMobile ? (
          <ResponsiveTable<Product>
            ariaLabel="Produtos"
            rows={products}
            columns={cardColumns}
            getRowId={(p) => p.id}
            onRowClick={openEdit}
            rowLabel={(p) => `Editar ${p.name}`}
            isLoading={productsQuery.isLoading}
            isError={productsQuery.isError}
            error={errorCopy}
            empty={
              isFiltering
                ? emptyNoResults
                : { ...emptyFirstRun, action: createButton('Adicionar primeiro produto') }
            }
            footer={pagination}
          />
        ) : (
          <>
            <DataTable<Product>
              caption="Produtos"
              columns={tableColumns}
              rows={products}
              getRowId={(p) => p.id}
              loading={productsQuery.isLoading}
              loadingRows={6}
              onRowClick={openEdit}
              getRowLabel={(p) => `Editar ${p.name}`}
              getRowState={(p) =>
                panelOpen && editing?.id === p.id ? 'selected' : p.active ? undefined : 'muted'
              }
              error={productsQuery.isError ? <ErrorState {...errorCopy} /> : undefined}
              empty={
                isFiltering ? (
                  <EmptyState
                    variant="no-results"
                    {...emptyNoResults}
                    secondaryAction={
                      <Button variant="ghost" size="sm" onClick={clearFilters}>
                        Limpar filtros
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState {...emptyFirstRun} action={createButton('Adicionar primeiro produto')} />
                )
              }
            />
            {pagination}
          </>
        )}
      </div>

      {/* Painel criar/editar (Drawer desktop / sheet mobile) */}
      <ResponsivePanel
        open={panelOpen}
        onClose={closePanel}
        title={editing ? 'Editar produto' : 'Novo produto'}
        description={editing ? <span className="font-mono">{editing.sku ?? 'Sem SKU'}</span> : undefined}
      >
        <ProductForm product={editing} onDone={closePanel} />
      </ResponsivePanel>

      {/* Confirmação de arquivar — soft-delete, confirmação simples (UX §2.9) */}
      <Modal
        open={toArchive !== null}
        onClose={() => setToArchive(null)}
        title="Arquivar produto?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setToArchive(null)} disabled={remove.isPending}>
              Cancelar
            </Button>
            <ReadOnlyGuard>
              <Button variant="danger" loading={remove.isPending} onClick={confirmArchive}>
                Arquivar
              </Button>
            </ReadOnlyGuard>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-sm border border-danger/25 bg-danger/10 text-danger"
          >
            <AlertTriangle className="size-5" />
          </span>
          <p className="font-body text-sm text-text-mid">
            <span className="font-bold text-text">{toArchive?.name}</span> sai do catálogo ativo e
            deixa de ficar disponível para novos cards. Cards já vinculados não são afetados. Você
            pode recriá-lo depois.
          </p>
        </div>
      </Modal>
    </div>
  );
}
