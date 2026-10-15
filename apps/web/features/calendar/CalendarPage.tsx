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
import { Avatar, Button, IconButton, useToast } from '@hm/ui';
import { cn } from '@hm/ui/cn';
import { can, type Role } from '@hm/shared';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { HelpPanel } from '@/shared/components/help';
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/feedback';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { READ_ONLY_TOOLTIP, useIsReadOnly } from '@/shared/components/account-banner/useIsReadOnly';
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
import { eventTone } from './eventTone';
import { masterEventId, type EventContactSummary, type EventRow } from './types';
import './calendar-theme.css';

/** Visões da grade (FullCalendar). */
type GridView = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay';
/** Visões da Agenda: grade + a visão "Lista" (follow-ups por dia, F54-S03). */
type ViewName = GridView | 'list';

const ADMIN_ROLES: ReadonlySet<Role> = new Set(['OWNER', 'ADMIN']);

export function CalendarPage(): React.JSX.Element {
  const { toast } = useToast();
  const auth = useAuthStore((st) => st.auth);
  const role = auth?.role as Role | undefined;
  const myMemberId = auth?.memberId;
  const readOnly = useIsReadOnly();
  // Trial vencido/cancelado: a agenda segue legível, mas nada de escrita (a guarda real é o 402).
  const roleCanEdit = role ? can(role, 'event.edit') : false;
  const canEdit = roleCanEdit && !readOnly;
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
            // O chip por tipo é desenhado em `renderEventContent`; o calendário de origem
            // vira o pontinho de cor (DATA da API).
            classNames: ['hm-fc-event'],
            // Só permite arrastar/redimensionar quem pode editar este evento (criador/admin).
            editable: canEdit && (e.createdBy === myMemberId || canSeeOthers),
            // F54-S03: o contato viaja no chip do evento (quem atender) — render em eventContent.
            extendedProps: {
              calendarId: e.calendarId,
              contact: e.contact ?? null,
              type: e.type,
              status: e.status,
              calendarColor: color,
            },
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

  const helpSlot = (
    <HelpPanel title="Sobre a agenda">
      <CalendarHelp />
    </HelpPanel>
  );

  // ─── Mobile: delega para a agenda (S04 reconcilia trilha como sheet) ─────────
  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <PageHeader title="Agenda" helpSlot={helpSlot} />
        <MobileAgenda
          calendarId={selection.selectedIds[0] ?? ''}
          canEdit={canEdit}
          onOpenEvent={(id) => setDetailId(id)}
          onCreateForDay={(start, end) => openCreate(start, end)}
        />
        {roleCanEdit && (
          <div className="pb-safe sticky bottom-0">
            <Button
              variant="primary"
              className="w-full touch-target"
              disabled={readOnly}
              title={readOnly ? READ_ONLY_TOOLTIP : undefined}
              onClick={() => openCreate()}
            >
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
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Agenda"
        description={isList ? 'Follow-ups por dia' : undefined}
        helpSlot={helpSlot}
        actions={
          roleCanEdit ? (
            <Button
              variant="primary"
              disabled={readOnly}
              title={readOnly ? READ_ONLY_TOOLTIP : 'Novo evento (N)'}
              leftIcon={<CalendarPlus className="size-4" aria-hidden />}
              onClick={() => openCreate()}
            >
              Novo evento
            </Button>
          ) : undefined
        }
      />

      {/* Barra de período: navegação à esquerda, visões à direita. */}
      <div className="-mt-2 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* Navegação de período só faz sentido na grade (a Lista tem janela própria). */}
          {!isList ? (
            <>
              <div className="flex items-center gap-1">
                <IconButton
                  variant="solid"
                  aria-label="Período anterior"
                  icon={<ChevronLeft />}
                  onClick={() => api()?.prev()}
                />
                <IconButton
                  variant="solid"
                  aria-label="Próximo período"
                  icon={<ChevronRight />}
                  onClick={() => api()?.next()}
                />
                <Button variant="secondary" onClick={() => api()?.today()} title="Ir para hoje (T)">
                  Hoje
                </Button>
              </div>
              {title ? (
                <h2
                  aria-live="polite"
                  className="truncate pl-2 font-head text-lg font-semibold capitalize tracking-tight text-text"
                >
                  {title}
                </h2>
              ) : null}
            </>
          ) : null}
        </div>
        <ViewSwitcher value={view} onChange={setFcView} />
      </div>

      {/* Erro de carregamento dos calendários */}
      {calendarsQuery.isError ? (
        <ErrorState
          title="Não foi possível carregar seus calendários"
          reason="Houve uma falha de conexão com o servidor."
          whatToDo="Tente de novo; se persistir, recarregue a página."
          action={
            <Button variant="secondary" size="sm" onClick={() => void calendarsQuery.refetch()}>
              Tentar de novo
            </Button>
          }
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
          <aside className="flex min-h-0 flex-col rounded-lg border border-border bg-surface-inset p-3">
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
              <div
                role="alert"
                className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 font-body text-sm text-danger"
              >
                Não foi possível carregar os eventos desta janela. Sua conexão pode ter oscilado.
                <Button variant="secondary" size="sm" onClick={() => void eventsQuery.refetch()}>
                  Tentar de novo
                </Button>
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
                className="hm-calendar relative min-h-0 flex-1 rounded-lg border border-border bg-surface p-3"
                aria-busy={eventsQuery.isLoading}
              >
                {eventsQuery.isLoading ? <GridLoading /> : null}
                <FullCalendar
                  ref={calendarRef}
                  plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                  initialView={gridView}
                  headerToolbar={false}
                  locale="pt-br"
                  firstDay={0}
                  height="100%"
                  nowIndicator
                  eventDisplay="block"
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
 * Render do chip de evento na grade (maquete "Unified calendar"): tinta + barra à esquerda no
 * tom do TIPO (token), horário em mono, e o CLIENTE (foto + nome) quando há contato — quem
 * atender (F54-S03). O calendário de origem fica no pontinho à direita. Zero hex.
 */
function renderEventContent(arg: EventContentArg): React.JSX.Element {
  const props = arg.event.extendedProps;
  const contact = props['contact'] as EventContactSummary | null | undefined;
  const type = typeof props['type'] === 'string' ? props['type'] : 'other';
  const completed = props['status'] === 'completed';
  const calendarColor = typeof props['calendarColor'] === 'string' ? props['calendarColor'] : null;
  const tone = eventTone(type);
  const label = contact?.name?.trim() || arg.event.title;
  // Concluído recua por COR, não por opacidade (opacidade derrubava o contraste a 2,5:1 no
  // claro): fundo neutro `surface-3`, barra `text-low`, título riscado em `text-mid`
  // (10,0:1 escuro / 7,5:1 claro) e horário em `text-low` (4,57:1 / 5,03:1).
  return (
    <div
      data-event-tone={tone.name}
      data-completed={completed || undefined}
      className={cn(
        'hm-fc-chip flex h-full w-full min-w-0 items-start gap-1 overflow-hidden rounded-sm border-l-[3px] px-1.5 py-0.5',
        completed ? 'border-l-text-low bg-surface-3' : tone.chip,
      )}
    >
      {contact ? <Avatar src={contact.avatarUrl} name={label} size="sm" className="size-4" /> : null}
      <span
        className={cn(
          'min-w-0 flex-1 truncate font-body text-xs font-bold leading-snug',
          completed ? 'text-text-mid' : 'text-text',
        )}
      >
        {arg.timeText ? (
          <span
            className={cn(
              'mr-1 font-mono font-semibold tabular-nums',
              completed ? 'text-text-low' : 'text-text-mid',
            )}
          >
            {arg.timeText}
          </span>
        ) : null}
        <span className={cn(completed && 'line-through')}>{label}</span>
      </span>
      {calendarColor ? (
        <span
          aria-hidden
          className="mt-1 size-1.5 shrink-0 rounded-pill"
          style={{ backgroundColor: calendarColor }}
        />
      ) : null}
    </div>
  );
}

/** Véu de carregamento da grade: mantém a forma, sem layout shift. */
function GridLoading(): React.JSX.Element {
  return (
    <div
      aria-hidden
      className="absolute inset-3 z-10 flex flex-col gap-3 rounded-md bg-surface/80 p-3 backdrop-blur-[2px]"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-10 rounded-md" />
      ))}
    </div>
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
        Marque a caixa de cor para mostrar ou ocultar cada calendário. A cor do evento diz o
        tipo do compromisso (atendimento, demonstração, follow-up, proposta); o pontinho diz de
        qual calendário ele vem. A legenda no rodapé da trilha mostra as duas. Sua seleção fica
        salva neste navegador.
      </p>
      <p>
        Arraste sobre a grade para criar um evento. Para reagendar, arraste o evento; para mudar a
        duração, puxe a borda — você só consegue mexer nos eventos que pode editar.
      </p>
      <p>
        Atalhos: <strong>N</strong> novo evento, <strong>T</strong> ir para hoje,{' '}
        <strong>1</strong>/<strong>2</strong>/<strong>3</strong>/<strong>4</strong> alternar mês,
        semana, dia e lista. Na semana e no dia, a linha verde marca o agora.
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
    <div
      role="group"
      aria-label="Visão da agenda"
      className="flex items-center rounded-md border border-border bg-surface-inset p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          title={`${o.label} (${o.hint})`}
          className={cn(
            'h-8 rounded-sm px-3 font-body text-sm font-bold outline-none transition-[color,background-color,box-shadow] duration-(--dur-fast) ease-ds focus-visible:focus-ring motion-reduce:transition-none',
            value === o.value
              ? 'bg-surface-3 text-text shadow-ds-1'
              : 'text-text-low hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
