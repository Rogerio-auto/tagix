'use client';

import type { CalendarRow } from '../types';
import type { CalendarSelection } from '../queries';

export interface CalendarLegendProps {
  readonly calendars: readonly CalendarRow[];
  readonly selection: CalendarSelection;
}

/**
 * Legenda compacta dos calendários atualmente visíveis (cor → nome). Aparece no rodapé
 * da trilha para reforçar a leitura da grade colorida por calendário.
 */
export function CalendarLegend({ calendars, selection }: CalendarLegendProps): React.JSX.Element | null {
  const visible = calendars.filter((c) => selection.isSelected(c.id));
  if (visible.length === 0) return null;
  return (
    <div className="mt-auto flex flex-col gap-1.5 border-t border-border-2 pt-3">
      <span className="px-2 text-[11px] font-semibold uppercase tracking-wide text-text-low">
        Legenda
      </span>
      <ul className="flex flex-wrap gap-x-3 gap-y-1.5 px-2">
        {visible.map((c) => (
          <li key={c.id} className="flex items-center gap-1.5 text-xs text-text-mid">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: c.color }}
            />
            <span className="truncate">{c.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
