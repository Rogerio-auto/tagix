import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../lib/cn';
import { Skeleton } from '../Skeleton/Skeleton';

export type DataTableAlign = 'left' | 'right' | 'center';
export type DataTableDensity = 'compact' | 'comfortable';
/** Estado visual de uma linha: `selected` (aberta no Drawer), `attention` (precisa de ação), `muted` (arquivada/inativa). */
export type DataTableRowState = 'selected' | 'attention' | 'muted';
export type DataTableSortDirection = 'asc' | 'desc';

export interface DataTableSort {
  columnId: string;
  direction: DataTableSortDirection;
}

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Valores numéricos/monetários/tempo: mono, tabular e alinhados à direita (maquete "Operational table"). */
  numeric?: boolean;
  align?: DataTableAlign;
  /** Largura CSS da coluna (ex.: `'8rem'`). */
  width?: string;
  /** Mostra o botão de ordenação no cabeçalho (exige `onSortChange` na tabela). */
  sortable?: boolean;
  /** Nome acessível do cabeçalho quando `header` não é texto simples. */
  headerLabel?: string;
}

export interface DataTableProps<T> {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: ReadonlyArray<T>;
  getRowId: (row: T) => string;
  /** Rótulo acessível da tabela (lido por leitor de tela; não é exibido). */
  caption: string;
  density?: DataTableDensity;
  /** Esqueleto no formato da tabela; evita CLS na chegada dos dados (UX §2.7). */
  loading?: boolean;
  loadingRows?: number;
  /** Conteúdo do vazio (use `<EmptyState />`); renderizado dentro da tabela. */
  empty?: ReactNode;
  /** Conteúdo de erro (use `<ErrorState />`); tem precedência sobre `empty`. */
  error?: ReactNode;
  /** Ação primária = clique na linha (UX §2.1). Enter/Espaço também disparam. */
  onRowClick?: (row: T) => void;
  getRowState?: (row: T) => DataTableRowState | undefined;
  /** Rótulo acessível da linha clicável (ex.: "Abrir Maria Santos"). */
  getRowLabel?: (row: T) => string;
  sort?: DataTableSort | null;
  onSortChange?: (next: DataTableSort | null) => void;
  /** Altura máxima CSS do corpo rolável; o cabeçalho permanece fixo. */
  maxHeight?: string;
  className?: string;
}

const alignClass: Record<DataTableAlign, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

const densityCell: Record<DataTableDensity, string> = {
  compact: 'px-3 py-2',
  comfortable: 'px-4 py-3.5',
};

const rowStateClass: Record<DataTableRowState, string> = {
  selected:
    'bg-brand-text/8 hover:bg-brand-text/10 [&>td:first-child]:shadow-[inset_2px_0_0_0_var(--brand-text)]',
  attention: '[&>td:first-child]:shadow-[inset_2px_0_0_0_var(--warn)]',
  muted: '[&>td]:text-text-low',
};

function resolveAlign<T>(col: DataTableColumn<T>): DataTableAlign {
  return col.align ?? (col.numeric ? 'right' : 'left');
}

function nextSort(current: DataTableSort | null | undefined, columnId: string): DataTableSort | null {
  if (!current || current.columnId !== columnId) return { columnId, direction: 'asc' };
  if (current.direction === 'asc') return { columnId, direction: 'desc' };
  return null;
}

/**
 * Tabela operacional do DS 3.0 (maquete "Operational table"): cabeçalho fixo em mono
 * caixa-alta, números em mono à direita, hover de linha, densidade, estado por linha,
 * vazio/erro/carregando dentro da própria tabela.
 *
 * UX: §2.1 clique no corpo da linha é a ação primária; §2.10 teclado (Tab foca a linha,
 * Enter/Espaço abre, setas sobem/descem entre linhas); §2.6 vazio acionável; §2.7 skeleton.
 * A região rolável é focável para que o teclado também role (axe: scrollable-region-focusable).
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  density = 'comfortable',
  loading = false,
  loadingRows = 5,
  empty,
  error,
  onRowClick,
  getRowState,
  getRowLabel,
  sort,
  onSortChange,
  maxHeight,
  className,
}: DataTableProps<T>) {
  const clickable = Boolean(onRowClick);
  const cellPad = densityCell[density];

  const onRowKeyDown = (e: ReactKeyboardEvent<HTMLTableRowElement>, row: T) => {
    // Só reage quando a linha em si tem o foco: botões/links internos mantêm o próprio teclado.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClick?.(row);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const sibling =
        e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
      if (sibling instanceof HTMLElement && sibling.tabIndex >= 0) sibling.focus();
    }
  };

  const showError = !loading && Boolean(error);
  const showEmpty = !loading && !showError && rows.length === 0 && Boolean(empty);

  return (
    <div
      role="group"
      aria-label={caption}
      // Região rolável focável (só com maxHeight, quando de fato rola na vertical): teclado precisa rolar tabelas largas/altas (WCAG 2.1.1).
      tabIndex={maxHeight ? 0 : undefined}
      style={maxHeight ? { maxHeight } : undefined}
      className={cn(
        'overflow-auto rounded-lg border border-border bg-surface outline-none',
        'focus-visible:focus-ring',
        className,
      )}
    >
      <table aria-busy={loading || undefined} className="w-full border-collapse font-body text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => {
              const align = resolveAlign(col);
              const active = sort?.columnId === col.id ? sort : null;
              const ariaSort = active ? (active.direction === 'asc' ? 'ascending' : 'descending') : 'none';
              const sortable = Boolean(col.sortable && onSortChange);
              return (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={sortable ? ariaSort : undefined}
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    'sticky top-0 z-10 border-b border-border bg-surface-2 font-price text-xs font-semibold uppercase tracking-wider text-text-low',
                    cellPad,
                    alignClass[align],
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSortChange?.(nextSort(sort, col.id))}
                      aria-label={col.headerLabel ? `Ordenar por ${col.headerLabel}` : undefined}
                      className={cn(
                        '-mx-1.5 inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 uppercase tracking-wider outline-none',
                        'transition-colors duration-(--dur-fast) hover:text-text focus-visible:focus-ring',
                        active && 'text-text',
                        align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      {col.header}
                      {active ? (
                        active.direction === 'asc' ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-60" aria-hidden />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: Math.max(1, loadingRows) }).map((_, i) => (
              <tr key={`sk-${i}`} className="border-b border-border last:border-b-0">
                {columns.map((col, c) => (
                  <td key={col.id} className={cn(cellPad, alignClass[resolveAlign(col)])}>
                    <Skeleton
                      className={cn(
                        'inline-block h-3 align-middle',
                        c === 0 ? 'w-3/5' : col.numeric ? 'w-12' : 'w-2/5',
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}

          {showError && (
            <tr>
              <td colSpan={columns.length}>{error}</td>
            </tr>
          )}
          {showEmpty && (
            <tr>
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          )}

          {!loading &&
            !showError &&
            rows.map((row) => {
              const state = getRowState?.(row);
              return (
                <tr
                  key={getRowId(row)}
                  tabIndex={clickable ? 0 : undefined}
                  aria-label={clickable ? getRowLabel?.(row) : undefined}
                  aria-current={state === 'selected' ? 'true' : undefined}
                  data-state={state}
                  onClick={clickable ? () => onRowClick?.(row) : undefined}
                  onKeyDown={clickable ? (e) => onRowKeyDown(e, row) : undefined}
                  className={cn(
                    'border-b border-border transition-colors duration-(--dur-fast) ease-ds last:border-b-0',
                    'hover:bg-surface-2',
                    clickable &&
                      'cursor-pointer outline-none focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-text',
                    state && rowStateClass[state],
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={cn(
                        'text-text-mid',
                        cellPad,
                        alignClass[resolveAlign(col)],
                        col.numeric && 'font-price tabular-nums text-text',
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
        </tbody>
      </table>
      {loading && (
        <p role="status" className="sr-only">
          Carregando {caption}
        </p>
      )}
    </div>
  );
}
