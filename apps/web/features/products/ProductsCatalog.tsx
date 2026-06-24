'use client';

/**
 * Catálogo de produtos em Settings (F47-S05, /settings/products).
 *
 * Lista (busca por nome/SKU + filtro ativo + paginação), criar/editar em painel
 * responsivo (drawer no desktop / sheet no mobile — UX §2.3) e arquivar (soft-delete
 * com confirmação simples — UX §2.9). Três estados explícitos (empty/loading/error +
 * populated — UX §2.6/§2.7/§2.11). Valores em BRL via Intl. Verde-neon (brand) só no
 * CTA primário.
 *
 * §2.1: a ação primária de cada linha é o clique no corpo (abre edição) — arquivar é
 * uma ação secundária com botão isolado (stopPropagation). §2.10: `Cmd/Ctrl+K` foca a
 * busca; `Esc` limpa a busca quando focada.
 */
import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Package,
  Plus,
  Search,
  Tag,
} from 'lucide-react';
import { AnchoredHelpHint, Button, Modal, useToast } from '@hm/ui';
import { EmptyState } from '@/shared/components/feedback/EmptyState';
import { ErrorState } from '@/shared/components/feedback/ErrorState';
import { Skeleton } from '@/shared/components/feedback/Skeleton';
import { ApiError } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/cn';
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

export function ProductsCatalog(): React.JSX.Element {
  const { toast } = useToast();
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
    const onKey = (e: KeyboardEvent) => {
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
        toast({
          variant: 'error',
          title: 'Falha ao arquivar',
          description: err.message,
        }),
    });
  }

  const data = productsQuery.data;
  const products = data?.products ?? [];
  const totalPages = data?.totalPages ?? 1;
  const isInitialLoading = productsQuery.isLoading;
  const isFiltering = query.trim().length > 0 || filter !== 'all';

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="font-head text-2xl font-semibold text-text">Produtos</h1>
            <AnchoredHelpHint anchorKey="settings.products" />
          </div>
          <p className="font-body text-sm text-text-mid">
            Catálogo do seu workspace. Vincule produtos aos cards da pipeline para compor o valor do
            negócio.
          </p>
        </div>
        <Button variant="primary" leftIcon={<Plus className="size-4" />} onClick={openCreate}>
          Novo produto
        </Button>
      </header>

      {/* Busca + filtro */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-low"
            aria-hidden
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Buscar por nome ou SKU…"
            aria-label="Buscar produtos"
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
            className="h-11 w-full rounded-sm border border-border bg-surface-inset pr-3 pl-9 font-body text-base text-text outline-none transition-[color,border-color,box-shadow] duration-200 placeholder:text-text-low hover:border-border-2 focus:border-brand focus:shadow-glow-sm"
          />
        </div>
        <div
          role="tablist"
          aria-label="Filtrar por status"
          className="flex shrink-0 rounded-md border border-border-2 bg-surface-2 p-0.5"
        >
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={filter === opt.id}
              onClick={() => {
                setFilter(opt.id);
                setPage(1);
              }}
              className={cn(
                'rounded-sm px-3 py-1.5 font-body text-sm outline-none transition-colors duration-150 focus-visible:shadow-glow-md',
                filter === opt.id
                  ? 'bg-surface text-text shadow-elev-1'
                  : 'text-text-mid hover:text-text',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Estados: error → loading → empty → populated */}
      {productsQuery.isError ? (
        <ErrorState
          title="Não foi possível carregar o catálogo"
          reason={
            productsQuery.error instanceof ApiError
              ? productsQuery.error.message
              : 'Houve uma falha de comunicação com o servidor.'
          }
          whatToDo="Verifique sua conexão e tente novamente."
          reference={
            productsQuery.error instanceof ApiError ? productsQuery.error.ref : undefined
          }
          action={
            <Button variant="secondary" onClick={() => void productsQuery.refetch()}>
              Tentar novamente
            </Button>
          }
        />
      ) : isInitialLoading ? (
        <ul className="flex flex-col gap-2" aria-busy aria-label="Carregando produtos">
          {Array.from({ length: 6 }).map((_, i) => (
            <li
              key={i}
              className="flex items-center gap-4 rounded-md border border-border-2 p-4"
            >
              <Skeleton className="size-10 rounded-md" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-1/5" />
              </div>
              <Skeleton className="h-4 w-20" />
            </li>
          ))}
        </ul>
      ) : products.length === 0 ? (
        isFiltering ? (
          <EmptyState
            icon={Search}
            title="Nenhum produto encontrado"
            description="Nenhum produto bate com a busca ou o filtro atual. Ajuste os termos e tente de novo."
          />
        ) : (
          <EmptyState
            icon={Package}
            title="Nenhum produto ainda"
            description="Cadastre os produtos e serviços do seu workspace para vinculá-los aos cards e compor o valor de cada negócio."
            action={
              <Button
                variant="primary"
                leftIcon={<Plus className="size-4" />}
                onClick={openCreate}
              >
                Adicionar primeiro produto
              </Button>
            }
          />
        )
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {products.map((product) => (
              <li key={product.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openEdit(product)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openEdit(product);
                    }
                  }}
                  className="group flex cursor-pointer items-center gap-4 rounded-md border border-border-2 bg-surface p-4 outline-none transition-colors duration-150 hover:border-border hover:bg-surface-2 focus-visible:shadow-glow-md"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-10 shrink-0 place-items-center rounded-md',
                      product.active
                        ? 'bg-brand/10 text-brand'
                        : 'bg-surface-3 text-text-low',
                    )}
                  >
                    <Package className="size-5" />
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-body font-medium text-text">{product.name}</span>
                    <span className="flex items-center gap-2 truncate font-body text-xs text-text-low">
                      {product.sku ? (
                        <span className="inline-flex items-center gap-1">
                          <Tag className="size-3" aria-hidden />
                          {product.sku}
                        </span>
                      ) : (
                        <span>Sem SKU</span>
                      )}
                      {!product.active && (
                        <span className="rounded-pill bg-surface-3 px-1.5 py-0.5 text-[10px] text-text-mid">
                          Inativo
                        </span>
                      )}
                    </span>
                  </div>

                  <span className="shrink-0 font-price text-sm font-semibold text-text tabular-nums">
                    {formatCents(product.priceCents, product.currency)}
                  </span>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setToArchive(product);
                    }}
                    aria-label={`Arquivar ${product.name}`}
                    title="Arquivar"
                    className="touch-target grid shrink-0 place-items-center rounded-md text-text-low opacity-0 outline-none transition-[color,opacity] duration-150 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100 focus-visible:shadow-glow-md"
                  >
                    <Archive className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {/* Paginação */}
          {totalPages > 1 && (
            <nav
              aria-label="Paginação"
              className="flex items-center justify-between gap-3 pt-1"
            >
              <span className="font-body text-sm text-text-low">
                Página {data?.page ?? page} de {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(data?.page ?? page) <= 1 || productsQuery.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(data?.page ?? page) >= totalPages || productsQuery.isFetching}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Próxima
                </Button>
              </div>
            </nav>
          )}
        </>
      )}

      {/* Painel criar/editar (drawer desktop / sheet mobile) */}
      <ResponsivePanel
        open={panelOpen}
        onClose={closePanel}
        title={editing ? 'Editar produto' : 'Novo produto'}
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
            <Button variant="danger" loading={remove.isPending} onClick={confirmArchive}>
              Arquivar
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-md bg-danger/10 text-danger"
          >
            <AlertTriangle className="size-5" />
          </span>
          <p className="font-body text-sm text-text-mid">
            <span className="font-medium text-text">{toArchive?.name}</span> sai do catálogo ativo e
            deixa de ficar disponível para novos cards. Cards já vinculados não são afetados. Você
            pode recriá-lo depois.
          </p>
        </div>
      </Modal>
    </div>
  );
}
