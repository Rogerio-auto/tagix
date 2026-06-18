'use client';

import { useMemo } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@hm/ui';
import { cn } from '@hm/ui/cn';
import { Sheet } from '@/shared/components/Sheet';
import { buildRailGroups } from './CalendarRail';
import type { CalendarSelection } from './queries';
import type { CalendarMember, CalendarRow } from './types';

export interface MobileCalendarRailProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly calendars: readonly CalendarRow[];
  readonly members: readonly CalendarMember[];
  readonly myMemberId: string | undefined;
  /** OWNER/ADMIN veem o grupo "Pessoas" (pessoal dos colegas). */
  readonly canSeeOthers: boolean;
  /** MESMO estado de seleção do desktop (persistido por membro em localStorage). */
  readonly selection: CalendarSelection;
}

/**
 * Trilha de calendários no mobile (UX §2.3 — a trilha lateral do desktop vira `Sheet`).
 * Reusa o agrupamento de S03 (`buildRailGroups`) e a MESMA seleção persistida, garantindo
 * continuidade desktop↔mobile: ligar/desligar aqui reflete na grade do desktop e vice-versa.
 *
 * Cada linha é um alvo ≥44px (`touch-target`), com ponto de cor por calendário
 * (`calendars.color`, DATA da API → `style` inline, nunca literal de JSX). O corpo da
 * linha é clicável (UX §2.1); rodapé com "Mostrar todos / Limpar" na zona do polegar.
 */
export function MobileCalendarRail({
  open,
  onClose,
  calendars,
  members,
  myMemberId,
  canSeeOthers,
  selection,
}: MobileCalendarRailProps): React.ReactNode {
  const groups = useMemo(
    () => buildRailGroups({ calendars, members, myMemberId, canSeeOthers }),
    [calendars, members, myMemberId, canSeeOthers],
  );

  const selectedCount = selection.selectedIds.length;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="bottom"
      title="Calendários"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-text-low">
            {selectedCount === 0
              ? 'Nenhum visível'
              : `${selectedCount} ${selectedCount === 1 ? 'visível' : 'visíveis'}`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={selection.clear}>
              Limpar
            </Button>
            <Button variant="secondary" size="sm" onClick={selection.selectAll}>
              Mostrar todos
            </Button>
          </div>
        </div>
      }
    >
      <nav aria-label="Calendários" className="flex flex-col gap-5">
        {groups.map((group) => (
          <section key={group.id} className="flex flex-col gap-1">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-text-low">
              {group.title}
            </h3>
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
                        'group touch-target flex w-full items-center gap-3 rounded-md px-1 text-left',
                        'outline-none transition-colors duration-200',
                        'hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:shadow-glow-md',
                      )}
                    >
                      {/* Caixa de cor: preenchida quando visível, contorno quando oculta. */}
                      <span
                        aria-hidden
                        className={cn(
                          'flex size-5 shrink-0 items-center justify-center rounded-[6px] border transition-all duration-200',
                          checked ? 'border-transparent' : 'bg-transparent',
                        )}
                        style={{
                          backgroundColor: checked ? calendar.color : 'transparent',
                          borderColor: calendar.color,
                        }}
                      >
                        {checked ? <Check className="size-3.5 text-black/80" strokeWidth={3} /> : null}
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
    </Sheet>
  );
}
