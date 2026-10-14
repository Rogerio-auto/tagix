'use client';

/**
 * Agenda do dia na Home. Cada compromisso abre a Agenda; a hora é número, então vai
 * em mono. Hora no fuso do navegador (`toLocaleTimeString` sem locale literal).
 */
import type * as React from 'react';
import Link from 'next/link';
import { CalendarCheck } from 'lucide-react';
import type { TodayAppointment } from './types';

function horaLocal(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function TodayAgenda({
  appointments,
}: {
  appointments: readonly TodayAppointment[];
}): React.JSX.Element {
  if (appointments.length === 0) {
    return (
      <div className="flex items-center gap-3 px-4 py-8 sm:px-6">
        <CalendarCheck aria-hidden className="size-5 shrink-0 text-text-low" />
        <p className="font-body text-sm text-text-mid">Nada marcado para hoje.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {appointments.map((a) => (
        <li key={a.id}>
          <Link
            href="/calendar"
            className="flex items-center gap-4 px-4 py-3 -outline-offset-2 hover:bg-surface-2 focus-visible:focus-ring motion-safe:transition-colors sm:px-6"
          >
            <time
              dateTime={a.startsAt}
              className="shrink-0 font-mono text-sm tabular-nums text-text"
            >
              {horaLocal(a.startsAt)}
            </time>
            <span className="min-w-0">
              <span className="block truncate font-body text-sm font-bold text-text">
                {a.title}
              </span>
              {a.contactName !== null && (
                <span className="block truncate font-body text-sm text-text-low">
                  {a.contactName}
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
