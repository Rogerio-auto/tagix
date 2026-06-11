'use client';

import { useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { DateSelectArg, EventClickArg, EventInput } from '@fullcalendar/core';
import { CalendarPlus } from 'lucide-react';
import { Button } from '@hm/ui';
import { can, type Role } from '@hm/shared';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useCalendars, useEvents } from './queries';
import { EventForm } from './EventForm';
import { EventDetailModal } from './EventDetailModal';
import type { EventRow, EventType } from './types';

// Cores de evento por tipo via tokens DS v2 (var(--…)) — zero hex em JSX.
const TYPE_COLOR: Record<EventType, string> = {
  meeting: 'var(--brand)',
  demo: 'var(--info)',
  follow_up: 'var(--warn)',
  task: 'var(--brand-soft)',
  reminder: 'var(--success)',
  other: 'var(--text-low)',
};

export function CalendarPage(): React.JSX.Element {
  const role = useAuthStore((st) => st.auth?.role) as Role | undefined;
  const canEdit = role ? can(role, 'event.edit') : false;

  const calendarsQuery = useCalendars();
  const calendars = useMemo(() => calendarsQuery.data?.calendars ?? [], [calendarsQuery.data]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('');

  const eventsQuery = useEvents(selectedCalendarId ? { calendarId: selectedCalendarId } : {});
  const events = eventsQuery.data?.events ?? [];

  const fcEvents: EventInput[] = useMemo(
    () =>
      events
        .filter((e) => e.status !== 'cancelled')
        .map((e) => ({
          id: e.id,
          title: e.title,
          start: e.startAt,
          end: e.endAt,
          backgroundColor: TYPE_COLOR[e.type],
          borderColor: TYPE_COLOR[e.type],
        })),
    [events],
  );

  const calendarRef = useRef<FullCalendar>(null);

  // Estado dos modais.
  const [formOpen, setFormOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<EventRow | null>(null);
  const [slotStart, setSlotStart] = useState<string | null>(null);
  const [slotEnd, setSlotEnd] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  function openCreate(start?: string | null, end?: string | null): void {
    if (!canEdit) return;
    setEditEvent(null);
    setSlotStart(start ?? null);
    setSlotEnd(end ?? null);
    setFormOpen(true);
  }

  function onSelect(arg: DateSelectArg): void {
    openCreate(arg.start.toISOString(), arg.end.toISOString());
  }

  function onEventClick(arg: EventClickArg): void {
    setDetailId(arg.event.id);
  }

  function onEditFromDetail(event: EventRow): void {
    setDetailId(null);
    setEditEvent(event);
    setSlotStart(null);
    setSlotEnd(null);
    setFormOpen(true);
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-text">Agenda</h1>
        <div className="flex items-center gap-2">
          <select
            value={selectedCalendarId}
            onChange={(e) => setSelectedCalendarId(e.target.value)}
            className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text outline-none focus-visible:border-border-brand"
            aria-label="Filtrar por calendário"
          >
            <option value="">Todos os calendários</option>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {canEdit && (
            <Button variant="primary" size="sm" onClick={() => openCreate()}>
              <CalendarPlus className="size-4" />
              Novo evento
            </Button>
          )}
        </div>
      </div>

      {eventsQuery.isError ? (
        <p className="text-sm text-danger">Falha ao carregar eventos.</p>
      ) : null}

      <div className="hm-calendar min-h-0 flex-1 rounded-lg border border-border bg-surface p-3">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          locale="pt-br"
          firstDay={0}
          height="100%"
          nowIndicator
          selectable={canEdit}
          selectMirror
          select={onSelect}
          events={fcEvents}
          eventClick={onEventClick}
          loading={(isLoading) => void isLoading}
        />
      </div>

      <EventForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        calendars={calendars}
        defaultCalendarId={selectedCalendarId || undefined}
        defaultStart={slotStart}
        defaultEnd={slotEnd}
        event={editEvent}
      />

      <EventDetailModal
        eventId={detailId}
        onClose={() => setDetailId(null)}
        canEdit={canEdit}
        onEdit={onEditFromDetail}
      />
    </div>
  );
}
