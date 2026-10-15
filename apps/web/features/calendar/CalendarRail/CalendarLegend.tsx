'use client';

import { useId } from 'react';
import { cn } from '@hm/ui/cn';
import type { CalendarRow } from '../types';
import type { CalendarSelection } from '../queries';
import { EVENT_TONE_LEGEND } from '../eventTone';

export interface CalendarLegendProps {
  readonly calendars: readonly CalendarRow[];
  readonly selection: CalendarSelection;
}

/**
 * Legenda no rodapé da trilha (DS 3.0 "Unified calendar"): a COR do chip diz o tipo do
 * compromisso (tom de token) e o PONTINHO diz de qual calendário ele vem (cor do dado).
 */
export function CalendarLegend({ calendars, selection }: CalendarLegendProps): React.JSX.Element {
  const visible = calendars.filter((c) => selection.isSelected(c.id));
  // Ids únicos por instância: a trilha existe no desktop e no sheet mobile ao mesmo tempo.
  const typesId = useId();
  const sourcesId = useId();
  return (
    <div className="mt-auto flex flex-col gap-3 border-t border-border pt-3">
      <section aria-labelledby={typesId} className="flex flex-col gap-1.5">
        <h3
          id={typesId}
          className="px-2 font-mono text-xs font-semibold uppercase tracking-wider text-text-low"
        >
          Tipos
        </h3>
        <ul className="flex flex-col gap-1 px-2">
          {EVENT_TONE_LEGEND.map(({ tone, label }) => (
            <li key={tone.name} className="flex items-center gap-2 font-body text-xs text-text-mid">
              <span aria-hidden className={cn('h-3 w-4 shrink-0 rounded-xs border-l-[3px]', tone.chip)} />
              <span className="truncate">{label}</span>
            </li>
          ))}
        </ul>
      </section>
      {visible.length > 0 ? (
        <section aria-labelledby={sourcesId} className="flex flex-col gap-1.5">
          <h3
            id={sourcesId}
            className="px-2 font-mono text-xs font-semibold uppercase tracking-wider text-text-low"
          >
            Calendários
          </h3>
          <ul className="flex flex-wrap gap-x-3 gap-y-1.5 px-2">
            {visible.map((c) => (
              <li key={c.id} className="flex min-w-0 items-center gap-1.5 font-body text-xs text-text-mid">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-pill"
                  style={{ backgroundColor: c.color }}
                />
                <span className="truncate">{c.name}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
