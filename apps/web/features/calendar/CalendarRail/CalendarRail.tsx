'use client';

import { useMemo } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@hm/ui/cn';
import type { CalendarMember, CalendarRow } from '../types';
import type { CalendarSelection } from '../queries';
import { buildRailGroups } from './groups';

export interface CalendarRailProps {
  readonly calendars: readonly CalendarRow[];
  readonly members: readonly CalendarMember[];
  readonly myMemberId: string | undefined;
  /** OWNER/ADMIN veem o grupo "Pessoas" (pessoal dos colegas). */
  readonly canSeeOthers: boolean;
  readonly selection: CalendarSelection;
}

/**
 * Trilha lateral de calendários (estilo Google Calendar, DS v2). Grupos
 * Meu calendário · Empresa · Times · (owner) Pessoas; cada item é uma linha-checkbox
 * com ponto de cor + nome. Clique no corpo (UX §2.1) alterna a visibilidade.
 * A cor vem de `calendars.color` (DATA da API) — usada via `style` inline, não literal.
 */
export function CalendarRail({
  calendars,
  members,
  myMemberId,
  canSeeOthers,
  selection,
}: CalendarRailProps): React.JSX.Element {
  const groups = useMemo(
    () => buildRailGroups({ calendars, members, myMemberId, canSeeOthers }),
    [calendars, members, myMemberId, canSeeOthers],
  );

  return (
    <nav aria-label="Calendários" className="flex h-full flex-col gap-5 overflow-y-auto pr-1">
      {groups.map((group) => (
        <section key={group.id} className="flex flex-col gap-1">
          <h2 className="px-2 text-[11px] font-semibold uppercase tracking-wide text-text-low">
            {group.title}
          </h2>
          <ul className="flex flex-col">
            {group.items.map(({ calendar, label }) => {
              const checked = selection.isSelected(calendar.id);
              return (
                <li key={calendar.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => selection.toggle(calendar.id)}
                    title={label}
                    className={cn(
                      'group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
                      'outline-none transition-colors duration-200',
                      'hover:bg-surface-2 focus-visible:shadow-glow-md',
                    )}
                  >
                    {/* Caixa de cor: preenchida quando visível, contorno quando oculta. */}
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-all duration-200',
                        checked ? 'border-transparent' : 'bg-transparent',
                      )}
                      style={{
                        backgroundColor: checked ? calendar.color : 'transparent',
                        borderColor: calendar.color,
                      }}
                    >
                      {checked ? <Check className="size-3 text-black/80" strokeWidth={3} /> : null}
                    </span>
                    <span
                      className={cn(
                        'truncate text-sm transition-colors duration-200',
                        checked ? 'text-text' : 'text-text-low group-hover:text-text-mid',
                      )}
                    >
                      {label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
