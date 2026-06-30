'use client';

/**
 * Card de tabela column-aware (DASHBOARD §3.2 — performance por atendente, rankings
 * de conversão, inbox por canal). Renderiza o contrato `{columns, rows}` do F28-S01
 * de forma genérica: o servidor descreve as colunas (label/align); o front nunca
 * hardcoda schema. Clicar abre o drawer com o detalhe completo (§4) — sem modal.
 *
 * Realces: badge de SLA na coluna `sla_status` (ok/violado) e destaque do top
 * performer (1ª linha quando há coluna `conversoes` — backend ordena desc). a11y:
 * cabeçalho com `<th scope="col">`, números alinhados à direita, contraste AAA.
 */
import { cn } from '@/shared/lib/cn';
import type { DashboardCard, TableColumn } from '../types';
import { readTableValue } from '../types';
import { formatTableCell } from '../format';

interface TableCardProps {
  card: DashboardCard;
  onDrill?: (card: DashboardCard) => void;
}

function alignClass(col: TableColumn): string {
  if (col.align === 'right') return 'text-right';
  if (col.align === 'center') return 'text-center';
  return 'text-left';
}

/** Badge de SLA (coluna `sla_status`): verde = ok, âmbar = violado. Tokens DS. */
function SlaBadge({ status }: { status: string }): React.JSX.Element {
  const violado = status === 'violado' || status === 'warning';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill px-2 py-0.5 font-body text-xs',
        violado ? 'bg-warn/15 text-warn' : 'bg-success/15 text-success',
      )}
    >
      {violado ? 'Violado' : 'OK'}
    </span>
  );
}

function Cell({ column, value }: { column: TableColumn; value: unknown }): React.JSX.Element {
  if (column.key === 'sla_status') {
    return <SlaBadge status={String(value ?? '')} />;
  }
  const isNumeric = column.align === 'right';
  return (
    <span className={cn('font-body', isNumeric ? 'font-price text-text' : 'text-text-mid')}>
      {formatTableCell(column.key, value)}
    </span>
  );
}

export function TableCard({ card, onDrill }: TableCardProps): React.JSX.Element {
  const table = readTableValue(card.value);
  const columns = table?.columns ?? [];
  const rows = (table?.rows ?? []).slice(0, 6);
  // Top performer: 1ª linha de um ranking (tem coluna `conversoes`).
  const isRanking = columns.some((c) => c.key === 'conversoes');

  return (
    <button
      type="button"
      onClick={onDrill ? () => onDrill(card) : undefined}
      className={cn(
        'flex h-full w-full flex-col rounded-lg border border-border bg-surface p-4 text-left transition-colors sm:p-5',
        onDrill && 'hover:border-border-brand',
      )}
    >
      <span className="font-head text-sm font-medium text-text">{card.label}</span>
      {rows.length === 0 || columns.length === 0 ? (
        <p className="mt-4 font-body text-sm text-text-low">Sem dados.</p>
      ) : (
        // Scroll horizontal contido: no mobile (card full-width) tabelas largas
        // rolam dentro do card em vez de estourar a viewport (F36-S06).
        <div className="-mx-1 mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-2">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    'pb-2 font-body text-xs font-medium uppercase tracking-wide text-text-low',
                    alignClass(col),
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className={cn(
                  'border-b border-border last:border-0',
                  // Top performer destacado por fundo neutro (não verde — neon é só do KPI).
                  isRanking && i === 0 && 'bg-surface-2',
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn('py-1.5', alignClass(col))}>
                    <Cell column={col} value={r[col.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </button>
  );
}
