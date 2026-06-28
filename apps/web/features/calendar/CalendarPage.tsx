'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
// Nota: visões mês/semana/dia cobrem a "agenda" pedida; sem @fullcalendar/list (não é dep).
import type {
  DateSelectArg,
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
} from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { CalendarPlus, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Avatar, Button, useToast } from '@hm/ui';
import { cn } from '@hm/ui/cn';
import { can, type Role } from '@hm/shared';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { HelpPanel } from '@/shared/components/help';
import { EmptyState, ErrorState } from '@/shared/components/feedback';
import {
  useCalendars,
  useCalendarMembers,
  useCalendarSelection,
  useEvents,
  useUpdateEvent,
} from './queries';
import { EventForm } from './EventForm';
import { EventDetailModal } from './EventDetailModal';
import { MobileAgenda } from './MobileAgenda';
import { AgendaListView } from './AgendaListView';
import { CalendarRail, CalendarLegend } from './CalendarRail';
import { masterEventId, type EventContactSummary, type EventRow } from './types';

/** Visões da grade (FullCalendar). */
type GridView = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay';
/** Visões da Agenda: grade + a visão "Lista" (follow-ups por dia, F54-S03). */
type ViewName = GridView | 'list';

const ADMIN_ROLES: ReadonlySet<Role> = new Set(['OWNER', 'ADMIN']);

/**
 * Tema do FullCalendar via CSS custom properties (`--fc-*`) mapeadas para tokens DS v2.
 * Mantém a grade dark-first e coerente sem editar CSS global. Os valores são `var(--token)`
 * (zero hex literal). A cor de CADA evento vem de `calendars.color` (DATA da API).
 */
const FC_THEME: React.CSSProperties = {
  ['--fc-border-color' as string]: 'var(--border-2)',
  ['--fc-page-bg-color' as string]: 'transparent',
  ['--fc-neutral-bg-color' as string]: 'var(--surface-2)',
  ['--fc-today-bg-color' as string]: 'var(--surface-2)',
  ['--fc-now-indicator-color' as string]: 'var(--danger)',
  ['--fc-event-text-color' as string]: 'var(--text)',
};

export function CalendarPage(): React.JSX.Element {
  const { toast } = useToast();
  const auth = useAuthStore((st) => st.auth);
  const role = auth?.role as Role | undefined;
  const myMemberId = auth?.memberId;
  const canEdit = role ? can(role, 'event.edit') : false;
  const canSeeOthers = role ? ADMIN_ROLES.has(role) : false;
  const { isMobile } = useBreakpoint();

  const calendarsQuery = useCalendars();
  const calendars = useMemo(() => calendarsQuery.data?.calendars ?? [], [calendarsQuery.data]);
  const membersQuery = useCalendarMembers();
  const members = useMemo(() => membersQuery.data?.members ?? [], [membersQuery.data]);

  const availableIds = useMemo(() => calendars.map((c) => c.id), [calendars]);
  const selection = useCalendarSelection(availableIds, myMemberId);

  // Mapa id→cor para colorir cada evento pelo seu calendário.
  const colorByCalendar = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of calendars) m.set(c.id, c.color);
    return m;
  }, [calendars]);

  // Janela visível (datesSet) → alimenta a query (a API expande recorrência na janela).
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  const eventsQuery = useEvents({
    calendarIds: selection.selectedIds,
    from: range?.from,
    to: range?.to,
  });
  const events = useMemo(() => eventsQuery.data?.events ?? [], [eventsQuery.data]);

  const fcEvents: EventInput[] = useMemo(
    () =>
      events
        .filter((e) => e.status !== 'cancelled')
        .map((e) => {
          const color = colorByCalendar.get(e.calendarId) ?? 'var(--text-low)';
          return {
            id: e.id,
            title: e.title,
            start: e.startAt,
            end: e.endAt,
            backgroundColor: color,
            borderColor: color,
            // Só permite arrastar/redimensionar quem pode editar este evento (criador/admin).
            editable: canEdit && (e.createdBy === myMemberId || canSeeOthers),
            // F54-S03: o contato viaja no chip do evento (quem atender) — render em eventContent.
            extendedProps: { calendarId: e.calendarId, contact: e.contact ?? null },
          } satisfies EventInput;
        }),
    [events, colorByCalendar, canEdit, myMemberId, canSeeOthers],
  );

  const calendarRef = useRef<FullCalendar>(null);
  const [view, setView] = useState<ViewName>('timeGridWeek');
  // Última visão de GRADE — usada como `initialView` ao voltar da Lista (a grade
  // remonta, pois a Lista a desmonta) para reabrir na mesma visão.
  const [gridView, setGridView] = useState<GridView>('timeGridWeek');
  const [title, setTitle] = useState('');
  const isList = view === 'list';

  // Estado dos modais.
  const [formOpen, setFormOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<EventRow | null>(null);
  const [slotStart, setSlotStart] = useState<string | null>(null);
  const [slotEnd, setSlotEnd] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const api = useCallback(() => calendarRef.current?.getApi() ?? null, []);

  const openCreate = useCallback(
    (start?: string | null, end?: string | null): void => {
      if (!canEdit) return;
      setEditEvent(null);
      setSlotStart(start ?? null);
      setSlotEnd(end ?? null);
      setFormOpen(true);
    },
    [canEdit],
  );

  function onSelect(arg: DateSelectArg): void {
    openCreate(arg.start.toISOString(), arg.end.toISOString());
  }

  function onEventClick(arg: EventClickArg): void {
    // Ocorrência recorrente → abre o detalhe do MESTRE (ids sintéticos `evt:<id>:<...>`).
    const raw = arg.event.id;
    setDetailId(masterEventId({ id: raw, recurrenceParentId: null }));
  }

  function onEditFromDetail(event: EventRow): void {
    setDetailId(null);
    setEditEvent(event);
    setSlotStart(null);
    setSlotEnd(null);
    setFormOpen(true);
  }

  const update = useUpdateEvent();

  // Mover / redimensionar → PUT start/end no MESTRE; reverte no erro (UX §2.7).
  const onEventMutate = useCallback(
    (arg: EventDropArg | EventResizeDoneArg): void => {
      const start = arg.event.start;
      const end = arg.event.end;
      if (!start || !end) {
        arg.revert();
        return;
      }
      const targetId = masterEventId({ id: arg.event.id, recurrenceParentId: null });
      update.mutate(
        { id: targetId, patch: { startAt: start.toISOString(), endAt: end.toISOString() } },
        {
          onSuccess: () => toast({ variant: 'success', title: 'Evento reagendado.' }),
          onError: (e) => {
            arg.revert();
            toast({ variant: 'error', title: e.message });
          },
        },
      );
    },
    [update, toast],
  );

  const setFcView = useCallback(
    (next: ViewName): void => {
      setView(next);
      // A Lista não é uma visão do FullCalendar — só troca o modo de render.
      if (next === 'list') return;
      setGridView(next);
      api()?.changeView(next);
    },
    [api],
  );

  // Atalhos: n (novo), t (hoje), 1/2/3 (mês/semana/dia). Ignora quando digitando.
  useEffect(() => {
    if (isMobile) return;
    function onKey(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (formOpen || detailId) return;
      switch (e.key) {
        case 'n':
          e.preventDefault();
          openCreate();
          break;
        case 't':
          api()?.today();
          break;
        case '1':
          setFcView('dayGridMonth');
          break;
        case '2':
          setFcView('timeGridWeek');
          break;
        case '3':
          setFcView('timeGridDay');
          break;
        case '4':
          setFcView('list');
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobile, formOpen, detailId, openCreate, api, setFcView]);

  function onDatesSet(arg: DatesSetArg): void {
    setRange({ from: arg.start.toISOString(), to: arg.end.toISOString() });
    setTitle(arg.view.title);
  }

  // ─── Mobile: delega para a agenda (S04 reconcilia trilha como sheet) ─────────
  if (isMobile) {
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-text">Agenda</h1>
        </div>
        <MobileAgenda
          calendarId={selection.selectedIds[0] ?? ''}
          canEdit={canEdit}
          onOpenEvent={(id) => setDetailId(id)}
          onCreateForDay={(start, end) => openCreate(start, end)}
        />
        {canEdit && (
          <div className="pb-safe sticky bottom-0">
            <Button variant="primary" className="w-full touch-target" onClick={() => openCreate()}>
              <CalendarPlus className="size-4" />
              Novo evento
            </Button>
          </div>
        )}
        <EventForm
          open={formOpen}
          onClose={() => setFormOpen(false)}
          calendars={calendars}
          defaultCalendarId={selection.selectedIds[0]}
          defaultStart={slotStart}
          defaultEnd={slotEnd}
          event={editEvent}
        />
        <EventDetailModal
          eventId={detailId}
          onClose={() => setDetailId(null)}
          canEdit={canEdit}
          onEdit={onEditFromDetail}
          myMemberId={myMemberId}
        />
      </div>
    );
  }

  const showEmpty =
    calendarsQuery.isSuccess && calendars.length === 0 && !calendarsQuery.isFetching;

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-text">Agenda</h1>
          {/* Navegação de período só faz sentido na grade (a Lista tem janela própria). */}
          {!isList ? (
            <>
              <div className="flex items-center gap-1">
                <IconNavButton aria-label="Anterior" onClick={() => api()?.prev()}>
                  <ChevronLeft className="size-4" />
                </IconNavButton>
                <IconNavButton aria-label="Próximo" onClick={() => api()?.next()}>
                  <ChevronRight className="size-4" />
                </IconNavButton>
                <Button variant="ghost" size="sm" onClick={() => api()?.today()}>
                  Hoje
                </Button>
              </div>
              {title ? (
                <span className="text-sm font-medium capitalize text-text-mid">{title}</span>
              ) : null}
            </>
          ) : (
            <span className="text-sm font-medium text-text-mid">Follow-ups por dia</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <ViewSwitcher value={view} onChange={setFcView} />
          <HelpPanel title="Sobre a agenda">
            <CalendarHelp />
          </HelpPanel>
          {canEdit && (
            <Button variant="primary" size="sm" onClick={() => openCreate()}>
              <CalendarPlus className="size-4" />
              Novo evento
            </Button>
          )}
        </div>
      </div>

      {/* Erro de carregamento dos calendários */}
      {calendarsQuery.isError ? (
        <ErrorState
          title="Não foi possível carregar seus calendários"
          reason="Houve uma falha de conexão com o servidor."
          whatToDo="Tente recarregar a página em instantes."
        />
      ) : showEmpty ? (
        <EmptyState
          icon={CalendarDays}
          title="Sua agenda está pronta"
          description="Nenhum calendário disponível ainda. Assim que houver, ele aparece na trilha à esquerda."
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr] gap-4 xl:grid-cols-[248px_1fr]">
          {/* Trilha de calendários */}
          <aside className="flex min-h-0 flex-col rounded-lg border border-border bg-surface p-3">
            <CalendarRail
              calendars={calendars}
              members={members}
              myMemberId={myMemberId}
              canSeeOthers={canSeeOthers}
              selection={selection}
            />
            <CalendarLegend calendars={calendars} selection={selection} />
          </aside>

          {/* Grade */}
          <div className="relative flex min-h-0 flex-col">
            {eventsQuery.isError ? (
              <div className="mb-2 rounded-md border border-danger/40 bg-danger-bg px-3 py-2 text-sm text-danger">
                Falha ao carregar eventos. Tente recarregar.
              </div>
            ) : null}

            {isList ? (
              <AgendaListView
                calendarIds={selection.selectedIds}
                selectionHydrated={selection.isHydrated}
                canEdit={canEdit}
                colorByCalendar={colorByCalendar}
                onEdit={onEditFromDetail}
              />
            ) : selection.selectedIds.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-surface">
                <EmptyState
                  icon={CalendarDays}
                  title="Nenhum calendário visível"
                  description="Ligue ao menos um calendário na trilha à esquerda para ver os eventos."
                />
              </div>
            ) : (
              <div
                className="hm-calendar min-h-0 flex-1 rounded-lg border border-border bg-surface p-3"
                style={FC_THEME}
              >
                <FullCalendar
                  ref={calendarRef}
                  plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                  initialView={gridView}
                  headerToolbar={false}
                  locale="pt-br"
                  firstDay={0}
                  height="100%"
                  nowIndicator
                  editable={canEdit}
                  selectable={canEdit}
                  selectMirror
                  dayMaxEvents
                  select={onSelect}
                  events={fcEvents}
                  eventContent={renderEventContent}
                  eventClick={onEventClick}
                  eventDrop={onEventMutate}
                  eventResize={onEventMutate}
                  datesSet={onDatesSet}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <EventForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        calendars={calendars}
        defaultCalendarId={selection.selectedIds[0]}
        defaultStart={slotStart}
        defaultEnd={slotEnd}
        event={editEvent}
      />

      <EventDetailModal
        eventId={detailId}
        onClose={() => setDetailId(null)}
        canEdit={canEdit}
        onEdit={onEditFromDetail}
        myMemberId={myMemberId}
      />
    </div>
  );
}

/**
 * Render do chip de evento na grade (F54-S03): mostra o CLIENTE (foto + nome) além
 * do horário, transformando a grade em leitura de "quem atender". Cai no título do
 * evento quando não há contato vinculado. Zero hex — herda a cor do calendário.
 */
function renderEventContent(arg: EventContentArg): React.JSX.Element {
  const contact = arg.event.extendedProps['contact'] as EventContactSummary | null | undefined;
  const label = contact?.name?.trim() || arg.event.title;
  return (
    <div className="flex w-full items-center gap-1 overflow-hidden px-0.5">
      {contact ? <Avatar src={contact.avatarUrl} name={label} size="sm" className="size-4" /> : null}
      <span className="min-w-0 truncate text-[0.6875rem] font-medium leading-tight">
        {arg.timeText ? <span className="mr-1 opacity-80">{arg.timeText}</span> : null}
        {label}
      </span>
    </div>
  );
}

function IconNavButton({
  children,
  onClick,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
} & Pick<React.AriaAttributes, 'aria-label'>): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      {...rest}
      className="flex size-8 items-center justify-center rounded-md text-text-low outline-none transition-colors duration-200 hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md"
    >
      {children}
    </button>
  );
}

/** Conteúdo do HelpPanel `?` (UX §2.5 — explicação de feature, nunca em tooltip). */
function CalendarHelp(): React.JSX.Element {
  return (
    <div className="space-y-3 font-body text-sm text-text-mid">
      <p>
        A trilha à esquerda lista seus calendários por grupo: o seu pessoal, o da Empresa, os
        times e — se você for proprietário ou administrador — o pessoal de cada membro.
      </p>
      <p>
        Marque a caixa de cor para mostrar ou ocultar cada calendário. Os eventos aparecem
        coloridos pelo calendário de origem; a legenda no rodapé ajuda a leitura. Sua seleção fica
        salva neste navegador.
      </p>
      <p>
        Arraste sobre a grade para criar um evento. Para reagendar, arraste o evento; para mudar a
        duração, puxe a borda — você só consegue mexer nos eventos que pode editar.
      </p>
      <p>
        Atalhos: <strong>N</strong> novo evento, <strong>T</strong> ir para hoje,{' '}
        <strong>1</strong>/<strong>2</strong>/<strong>3</strong> alternar mês, semana e dia.
      </p>
    </div>
  );
}

function ViewSwitcher({
  value,
  onChange,
}: {
  value: ViewName;
  onChange: (v: ViewName) => void;
}): React.JSX.Element {
  const options: ReadonlyArray<{ value: ViewName; label: string; hint: string }> = [
    { value: 'dayGridMonth', label: 'Mês', hint: '1' },
    { value: 'timeGridWeek', label: 'Semana', hint: '2' },
    { value: 'timeGridDay', label: 'Dia', hint: '3' },
    { value: 'list', label: 'Lista', hint: '4' },
  ];
  return (
    <div className="flex items-center rounded-md border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          title={`${o.label} (${o.hint})`}
          className={cn(
            'rounded px-2.5 py-1 text-sm outline-none transition-colors duration-200 focus-visible:shadow-glow-md',
            value === o.value ? 'bg-surface text-text shadow-elev-1' : 'text-text-low hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
