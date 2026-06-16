'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { ChevronRight, ListFilter, SlidersHorizontal, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { Sheet } from '@/shared/components/Sheet';
import { EmptyState } from '@/shared/components/feedback/EmptyState';
import { ErrorState } from '@/shared/components/feedback/ErrorState';
import { Skeleton } from '@/shared/components/feedback/Skeleton';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';

/* ────────────────────────────────────────────────────────────────────────────
 * ResponsiveTable — primitivo "Tabela→Cards" (F36-S05, MOBILE_UX §2/§4).
 *
 * CONTRATO (estável; consumido por contatos + S08/S09/S10/S13):
 * Em `md+` renderiza uma TABELA densa; em `< md` (useBreakpoint().isMobile)
 * renderiza uma LISTA DE CARDS escaneáveis derivada das mesmas colunas, com a
 * ação primária no corpo do card. Filtros inline (desktop) viram um
 * bottom-`Sheet` de filtros + chips de filtro ativo (mobile). Trata os 3
 * estados (loading/empty/error) em ambos os layouts.
 *
 * O primitivo é AGNÓSTICO de domínio — não importa nada de contatos. Os dados,
 * colunas, filtros e ação primária são 100% injetados pelo consumidor.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Alinhamento horizontal de uma coluna na tabela (desktop). */
export type ColumnAlign = 'left' | 'right' | 'center';

/**
 * Papel da coluna no CARD mobile. Define onde o valor aparece quando a tabela
 * vira lista de cards. Colunas sem `card` (ou `card: 'hidden'`) não aparecem no
 * card — útil para colunas auxiliares densas que só fazem sentido no desktop.
 *
 * - `primary`   → título do card (linha de destaque). 1 por config (a 1ª vence).
 * - `secondary` → subtítulo logo abaixo do título.
 * - `meta`      → linha de metadados (rodapé do card), pode haver várias.
 * - `badge`     → canto superior direito do card (status/etiqueta).
 * - `avatar`    → slot circular à esquerda (iniciais/ícone/imagem).
 * - `hidden`    → não renderiza no card.
 */
export type ColumnCardRole = 'primary' | 'secondary' | 'meta' | 'badge' | 'avatar' | 'hidden';

export interface ResponsiveColumn<T> {
  /** Chave estável da coluna (key React + a11y). */
  id: string;
  /** Cabeçalho da coluna na tabela (desktop). Omita para coluna sem header. */
  header?: ReactNode;
  /** Renderiza o conteúdo da célula/slot a partir da linha. */
  cell: (row: T) => ReactNode;
  /** Alinhamento na tabela desktop. Default `left`. */
  align?: ColumnAlign;
  /** Largura da coluna na tabela (CSS, ex.: `'1px'`, `'40%'`). */
  width?: string;
  /** Papel no card mobile. Default `meta`. Use `hidden` para esconder no card. */
  card?: ColumnCardRole;
  /** Classe extra aplicada à célula (td) no desktop. */
  className?: string;
}

/** Chip de filtro ativo exibido no mobile (acima da lista de cards). */
export interface ActiveFilterChip {
  /** Identidade estável do chip. */
  id: string;
  /** Rótulo legível do filtro ativo (ex.: "Tag: VIP"). */
  label: string;
  /** Remove o filtro. Renderiza o "×" quando presente. */
  onClear?: () => void;
}

/** Config do estado vazio (UX §2.6). Repassada ao `EmptyState`. */
export interface ResponsiveTableEmpty {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** CTA primário ÚNICO. */
  action?: ReactNode;
}

/** Config do estado de erro (UX §2.11). Repassada ao `ErrorState`. */
export interface ResponsiveTableError {
  title: string;
  reason?: string;
  whatToDo?: string;
  reference?: string;
  action?: ReactNode;
}

export interface ResponsiveTableProps<T> {
  /** Linhas a renderizar. */
  rows: readonly T[];
  /** Config de colunas. Dirige tabela (desktop) E cards (mobile). */
  columns: readonly ResponsiveColumn<T>[];
  /** Identidade estável da linha (key React + alvo de clique). */
  getRowId: (row: T) => string;

  /**
   * Ação primária: clique no corpo da linha/card (UX §2.1). Quando presente, a
   * linha/card vira clicável (cursor, hover, foco, chevron no mobile).
   */
  onRowClick?: (row: T) => void;
  /** Rótulo a11y da ação primária por linha (ex.: `(r) => \`Abrir ${r.name}\``). */
  rowLabel?: (row: T) => string;

  /** ── Filtros ─────────────────────────────────────────────────────────────
   * `filters`: controles inline exibidos no desktop (acima da tabela). No
   * mobile esse mesmo conteúdo é movido para o bottom-`Sheet` de filtros.
   * `activeFilters`: chips de filtro ativo (mobile) — escaneáveis e removíveis.
   * `searchSlot`: campo de busca; fica sempre visível (desktop e topo do mobile).
   */
  filters?: ReactNode;
  activeFilters?: readonly ActiveFilterChip[];
  searchSlot?: ReactNode;
  /** Título do sheet de filtros (mobile). Default "Filtros". */
  filtersTitle?: string;
  /** Limpar todos os filtros (rodapé do sheet + chip "Limpar"). */
  onClearFilters?: () => void;

  /** ── Estados (UX §2.6/§2.7/§2.11) ───────────────────────────────────────── */
  isLoading?: boolean;
  isError?: boolean;
  empty: ResponsiveTableEmpty;
  error?: ResponsiveTableError;
  /** Nº de linhas-fantasma no skeleton. Default 6. */
  skeletonRows?: number;

  /** Rótulo a11y da tabela/lista. Ex.: "Contatos". */
  ariaLabel: string;
  /** Conteúdo após a lista/tabela (ex.: paginação). */
  footer?: ReactNode;
  /** Classe extra do contêiner raiz. */
  className?: string;
}

function alignClass(align: ColumnAlign | undefined): string {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

/**
 * Renderiza tabela densa (md+) ou lista de cards (mobile) a partir da MESMA
 * config de colunas. Veja o JSDoc do módulo para o contrato completo.
 */
export function ResponsiveTable<T>({
  rows,
  columns,
  getRowId,
  onRowClick,
  rowLabel,
  filters,
  activeFilters,
  searchSlot,
  filtersTitle = 'Filtros',
  onClearFilters,
  isLoading = false,
  isError = false,
  empty,
  error,
  skeletonRows = 6,
  ariaLabel,
  footer,
  className,
}: ResponsiveTableProps<T>): ReactNode {
  const { isMobile } = useBreakpoint();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const interactive = typeof onRowClick === 'function';
  const activeCount = activeFilters?.length ?? 0;

  // ── Estados terminais (compartilhados entre os dois layouts) ──────────────
  let body: ReactNode;
  if (isError) {
    const e = error ?? { title: 'Não foi possível carregar' };
    body = (
      <ErrorState
        title={e.title}
        reason={e.reason}
        whatToDo={e.whatToDo}
        reference={e.reference}
        action={e.action}
      />
    );
  } else if (isLoading) {
    body = isMobile ? (
      <MobileSkeleton rows={skeletonRows} />
    ) : (
      <TableSkeleton columns={columns} rows={skeletonRows} />
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon={empty.icon}
        title={empty.title}
        description={empty.description}
        action={empty.action}
      />
    );
  } else if (isMobile) {
    body = (
      <CardList
        rows={rows}
        columns={columns}
        getRowId={getRowId}
        onRowClick={onRowClick}
        rowLabel={rowLabel}
        interactive={interactive}
      />
    );
  } else {
    body = (
      <DesktopTable
        rows={rows}
        columns={columns}
        getRowId={getRowId}
        onRowClick={onRowClick}
        rowLabel={rowLabel}
        interactive={interactive}
        ariaLabel={ariaLabel}
      />
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Barra de busca + filtros. No desktop os filtros são inline; no mobile
          viram um botão que abre o sheet, com badge de contagem ativa. */}
      {(searchSlot || filters) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchSlot && <div className="min-w-0 flex-1">{searchSlot}</div>}

          {filters && !isMobile && (
            <div className="flex flex-wrap items-center gap-2">{filters}</div>
          )}

          {filters && isMobile && (
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              aria-label="Abrir filtros"
              aria-haspopup="dialog"
              className="touch-target relative inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium text-text outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:shadow-glow-md"
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              Filtros
              {activeCount > 0 && (
                <span className="grid size-5 place-items-center rounded-pill bg-brand text-xs font-semibold text-text-on-brand">
                  {activeCount}
                </span>
              )}
            </button>
          )}
        </div>
      )}

      {/* Chips de filtro ativo (mobile) — escaneáveis e removíveis. */}
      {isMobile && activeCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters?.map((chip) => (
            <span
              key={chip.id}
              className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface-2 py-1 pl-3 pr-2 text-xs text-text-mid"
            >
              {chip.label}
              {chip.onClear && (
                <button
                  type="button"
                  onClick={chip.onClear}
                  aria-label={`Remover filtro ${chip.label}`}
                  className="grid size-5 place-items-center rounded-pill text-text-low outline-none hover:text-text focus-visible:shadow-glow-md"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </span>
          ))}
          {onClearFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="rounded-sm px-1.5 py-1 text-xs font-medium text-text-low outline-none hover:text-text focus-visible:shadow-glow-md"
            >
              Limpar
            </button>
          )}
        </div>
      )}

      {body}

      {footer}

      {/* Bottom-sheet de filtros (mobile). Reusa o slot `filters` do consumidor. */}
      {isMobile && filters && (
        <Sheet
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          variant="bottom"
          title={
            <span className="inline-flex items-center gap-2">
              <ListFilter className="size-5 text-text-low" aria-hidden />
              {filtersTitle}
            </span>
          }
          ariaLabel={filtersTitle}
          footer={
            onClearFilters ? (
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    onClearFilters();
                  }}
                  disabled={activeCount === 0}
                  className="touch-target rounded-md px-3 text-sm font-medium text-text-low outline-none hover:text-text focus-visible:shadow-glow-md disabled:opacity-40"
                >
                  Limpar tudo
                </button>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="touch-target rounded-md bg-brand px-5 text-sm font-semibold text-text-on-brand outline-none transition-colors duration-150 hover:bg-brand/90 focus-visible:shadow-glow-md"
                >
                  Aplicar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="touch-target w-full rounded-md bg-brand text-sm font-semibold text-text-on-brand outline-none transition-colors duration-150 hover:bg-brand/90 focus-visible:shadow-glow-md"
              >
                Aplicar
              </button>
            )
          }
        >
          <div className="flex flex-col gap-4 [&_select]:w-full [&_input]:w-full">{filters}</div>
        </Sheet>
      )}
    </div>
  );
}

/* ── Desktop: tabela densa ──────────────────────────────────────────────── */

interface InnerProps<T> {
  rows: readonly T[];
  columns: readonly ResponsiveColumn<T>[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
  interactive: boolean;
}

function DesktopTable<T>({
  rows,
  columns,
  getRowId,
  onRowClick,
  rowLabel,
  interactive,
  ariaLabel,
}: InnerProps<T> & { ariaLabel: string }): ReactNode {
  const hasHeader = columns.some((c) => c.header != null);
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm" aria-label={ariaLabel}>
        {hasHeader && (
          <thead>
            <tr className="border-b border-border text-left">
              {columns.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    'px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-text-low',
                    alignClass(col.align),
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const id = getRowId(row);
            return (
              <tr
                key={id}
                {...(interactive
                  ? {
                      onClick: () => onRowClick?.(row),
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': rowLabel?.(row),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick?.(row);
                        }
                      },
                    }
                  : {})}
                className={cn(
                  'outline-none',
                  interactive &&
                    'cursor-pointer transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:shadow-glow-md',
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    style={col.width ? { width: col.width } : undefined}
                    className={cn('px-4 py-3 text-text', alignClass(col.align), col.className)}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Mobile: lista de cards ─────────────────────────────────────────────── */

function CardList<T>({
  rows,
  columns,
  getRowId,
  onRowClick,
  rowLabel,
  interactive,
}: InnerProps<T>): ReactNode {
  const avatar = columns.find((c) => c.card === 'avatar');
  const badge = columns.find((c) => c.card === 'badge');
  const primary = columns.find((c) => c.card === 'primary');
  const secondary = columns.find((c) => c.card === 'secondary');
  // `meta` é o default → toda coluna sem papel explícito (e visível) entra aqui,
  // exceto as já consumidas por avatar/badge/primary/secondary.
  const metas = columns.filter(
    (c) =>
      c.card !== 'hidden' &&
      c.card !== 'avatar' &&
      c.card !== 'badge' &&
      c.card !== 'primary' &&
      c.card !== 'secondary',
  );

  return (
    <ul className="flex flex-col gap-2" aria-label="Lista">
      {rows.map((row) => {
        const id = getRowId(row);
        const inner = (
          <>
            {avatar && <span className="shrink-0">{avatar.cell(row)}</span>}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              {primary && (
                <span className="truncate text-sm font-semibold text-text">
                  {primary.cell(row)}
                </span>
              )}
              {secondary && (
                <span className="truncate text-xs text-text-low">{secondary.cell(row)}</span>
              )}
              {metas.length > 0 && (
                <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-mid">
                  {metas.map((m) => (
                    <span key={m.id} className="min-w-0 truncate">
                      {m.cell(row)}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {badge && <span>{badge.cell(row)}</span>}
              {interactive && <ChevronRight className="size-4 text-text-low" aria-hidden />}
            </span>
          </>
        );

        return (
          <li key={id}>
            {interactive ? (
              <button
                type="button"
                onClick={() => onRowClick?.(row)}
                aria-label={rowLabel?.(row)}
                className="touch-target flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:shadow-glow-md"
              >
                {inner}
              </button>
            ) : (
              <div className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
                {inner}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ── Skeletons ───────────────────────────────────────────────────────────── */

function TableSkeleton<T>({
  columns,
  rows,
}: {
  columns: readonly ResponsiveColumn<T>[];
  rows: number;
}): ReactNode {
  return (
    <div
      className="overflow-hidden rounded-lg border border-border"
      aria-busy
      aria-label="Carregando"
    >
      <div className="flex flex-col divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3.5">
            {columns.map((col, i) => (
              <Skeleton
                key={col.id}
                className={cn('h-3.5', i === 0 ? 'w-2/5 flex-1' : 'w-16')}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileSkeleton({ rows }: { rows: number }): ReactNode {
  return (
    <div className="flex flex-col gap-2" aria-busy aria-label="Carregando">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3"
        >
          <Skeleton className="size-9 rounded-pill" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
