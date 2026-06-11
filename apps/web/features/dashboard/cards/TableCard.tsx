'use client';

/**
 * Card de tabela (DASHBOARD §3.2 — ex.: inbox por departamento, performance por
 * atendente). Renderiza `value.rows` de forma genérica. Clicar abre o drawer com o
 * detalhe completo (§4) — sem modal full-screen.
 */
import { cn } from '@/shared/lib/cn';
import type { DashboardCard } from '../types';
import { formatInt } from '../format';

interface TableCardProps {
  card: DashboardCard;
  onDrill?: (card: DashboardCard) => void;
}

function rowsOf(card: DashboardCard): Record<string, unknown>[] {
  const rows = card.value?.['rows'];
  if (!Array.isArray(rows)) return [];
  return rows.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null);
}

export function TableCard({ card, onDrill }: TableCardProps) {
  const rows = rowsOf(card).slice(0, 6);

  return (
    <button
      type="button"
      onClick={onDrill ? () => onDrill(card) : undefined}
      className={cn(
        'col-span-2 flex h-full flex-col rounded-lg border border-border bg-surface p-5 text-left transition-colors',
        onDrill && 'hover:border-border-brand',
      )}
    >
      <span className="font-body text-xs uppercase tracking-wide text-text-low">{card.label}</span>
      {rows.length === 0 ? (
        <p className="mt-4 font-body text-sm text-text-low">Sem dados.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="py-1.5 font-body text-text-mid">
                  {String(r['status'] ?? r['departmentId'] ?? `Item ${i + 1}`)}
                </td>
                <td className="py-1.5 text-right font-price text-text">
                  {formatInt(typeof r['count'] === 'number' ? r['count'] : Number(r['count'] ?? 0))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </button>
  );
}
