'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  ListFilter,
  MapPin,
  Repeat,
} from 'lucide-react';
import { Avatar, Button } from '@hm/ui';
import { cn } from '@hm/ui/cn';
import type { Role } from '@hm/shared';
import { useAuthStore } from '@/shared/stores/auth.store';
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/feedback';
import { READ_ONLY_TOOLTIP, useIsReadOnly } from '@/shared/components/account-banner/useIsReadOnly';
import { MobileCalendarRail } from './MobileCalendarRail';
import { useCalendarMembers, useCalendars, useCalendarSelection, useEvents } from './queries';
import { eventTone } from './eventTone';
import { uiLocale } from './locale';
import { isOccurrence } from './types';
import type { EventRow } from './types';

/** OWNER/ADMIN também enxergam o pessoal dos colegas (grupo "Pessoas" na trilha). */
const ADMIN_ROLES: ReadonlySet<Role> = new Set<Role>(['OWNER', 'ADMIN']);

/** Início do dia local (00:00) em ISO, no tz do browser. */
function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Soma dias mantendo o horário zerado. */
function addDays(d: Date, n: number): Date {
  const c = startOfDay(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** `Date` → valor de `<input type="date">` (yyyy-mm-dd local). */
function toDateInput(d: Date): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

/** Valor de `<input type="date">` → `Date` (meia-noite local). */
function fromDateInput(value: string): Date {
  const parts = value.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(y, m - 1, day);
}

function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/** Cabeçalho longo do dia: "segunda-feira, 16 de junho". */
function formatDayHeading(d: Date): string {
  return d.toLocaleDateString(uiLocale(), {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
}

/** Horário curto "14:30". */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(uiLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Relógio de 30s: posiciona a linha "agora" sem criar timers por item. */
function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface MobileAgendaProps {
  /**
   * @deprecated mantido por compat com o call site da `CalendarPage`. A agenda mobile passou
   * a respeitar a seleção multi-calendário (S04), lendo o MESMO estado persistido do desktop.
   */
  readonly calendarId?: string;
  readonly canEdit: boolean;
  /** Toque num evento → abre detalhe em sheet. */
  readonly onOpenEvent: (eventId: string) => void;
  /** Criar evento no dia selecionado → abre form em sheet com start/end pré. */
  readonly onCreateForDay: (start: string, end: string) => void;
}

/**
 * Visão agenda/dia para mobile (MOBILE_UX §2 "Calendário", §3.9 timeline vertical).
 * Dia único navegável (anterior/próximo + seletor de data) com timeline vertical de eventos.
 *
 * Calendar 2.0 (S04): respeita a seleção multi-calendário (overlay) — o MESMO estado
 * persistido por membro que o desktop usa, lido aqui via `useCalendarSelection` (continuidade
 * desktop↔mobile). Cada evento é colorido pelo seu calendário (`calendars.color`). A trilha
 * de calendários é um `Sheet` (UX §2.3), aberto pelo botão "Calendários".
 *
 * Recorrências chegam expandidas pela API (ocorrências com id sintético `evt:<id>:<startISO>`)
 * e aparecem normalmente na timeline. Datas/horas no idioma da interface e no fuso do navegador
 * (o mesmo dos limites do dia e da grade do desktop).
 */
export function MobileAgenda(props: MobileAgendaProps): React.JSX.Element {
  const auth = useAuthStore((st) => st.auth);
  const myMemberId = auth?.memberId;
  const canSeeOthers = auth?.role ? ADMIN_ROLES.has(auth.role) : false;

  const calendarsQuery = useCalendars();
  const calendars = useMemo(() => calendarsQuery.data?.calendars ?? [], [calendarsQuery.data]);
  const membersQuery = useCalendarMembers();
  const members = useMemo(() => membersQuery.data?.members ?? [], [membersQuery.data]);

  // Seleção multi-calendário — MESMA fonte (localStorage por membro) do desktop (S03).
  const availableIds = useMemo(() => calendars.map((c) => c.id), [calendars]);
  const selection = useCalendarSelection(availableIds, myMemberId);

  // Mapa id→cor para colorir cada evento pelo seu calendário (DATA, não literal).
  const colorByCalendar = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of calendars) m.set(c.id, c.color);
    return m;
  }, [calendars]);

  const readOnly = useIsReadOnly();
  const nowMs = useNowTick();
  const [day, setDay] = useState<Date>(() => startOfDay(new Date()));
  const [railOpen, setRailOpen] = useState(false);

  // Janela do dia selecionado [00:00, 23:59:59.999], em ISO. A API filtra por
  // `events.startAt` e expande recorrências na janela.
  const range = useMemo(() => {
    const from = startOfDay(day);
    const to = new Date(addDays(day, 1).getTime() - 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [day]);

  const eventsQuery = useEvents({
    calendarIds: selection.selectedIds,
    from: range.from,
    to: range.to,
  });

  const events = useMemo(() => {
    const all = eventsQuery.data?.events ?? [];
    return all
      .filter((e) => e.status !== 'cancelled')
      .slice()
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  }, [eventsQuery.data]);

  const today = startOfDay(new Date());
  const isToday = isSameDay(day, today);
  // "Agora" entra antes do primeiro evento que ainda não começou (ou ao fim, se todos já começaram).
  const nowIndex = useMemo(() => {
    const idx = events.findIndex((e) => new Date(e.startAt).getTime() > nowMs);
    return idx === -1 ? events.length : idx;
  }, [events, nowMs]);
  const selectedCount = selection.selectedIds.length;
  const noneSelected = selection.isHydrated && selectedCount === 0;

  function go(delta: number): void {
    setDay((d) => addDays(d, delta));
  }

  function createForSelectedDay(): void {
    // Slot default: próxima hora cheia (ou 09:00 se a data não é hoje), 60min.
    const base = new Date(day);
    if (isToday) {
      const now = new Date();
      base.setHours(now.getHours() + 1, 0, 0, 0);
    } else {
      base.setHours(9, 0, 0, 0);
    }
    const end = new Date(base.getTime() + 60 * 60_000);
    props.onCreateForDay(base.toISOString(), end.toISOString());
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Navegação de data — alvos ≥44px, toque-first */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="Dia anterior"
          className="touch-target grid place-items-center rounded-md border border-border bg-surface-2 text-text-mid outline-none transition-colors hover:text-text focus-visible:focus-ring"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>

        <label className="relative flex min-w-0 flex-1 cursor-pointer items-center justify-center rounded-md border border-border bg-surface-2 px-3 text-center">
          <span className="truncate font-body text-sm font-bold text-text first-letter:uppercase">
            {formatDayHeading(day)}
          </span>
          <input
            type="date"
            value={toDateInput(day)}
            onChange={(e) => {
              if (e.target.value) setDay(startOfDay(fromDateInput(e.target.value)));
            }}
            aria-label="Selecionar data"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>

        <button
          type="button"
          onClick={() => go(1)}
          aria-label="Próximo dia"
          className="touch-target grid place-items-center rounded-md border border-border bg-surface-2 text-text-mid outline-none transition-colors hover:text-text focus-visible:focus-ring"
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>

      {/* Linha de controles: "Hoje" + abrir a trilha de calendários (sheet) */}
      <div className="flex items-center gap-2">
        {!isToday && (
          <button
            type="button"
            onClick={() => setDay(today)}
            className="touch-target rounded-pill border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-mid outline-none transition-colors hover:text-text focus-visible:focus-ring"
          >
            Hoje
          </button>
        )}
        <button
          type="button"
          onClick={() => setRailOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={railOpen}
          className="touch-target ml-auto flex items-center gap-2 rounded-pill border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-mid outline-none transition-colors hover:text-text focus-visible:focus-ring"
        >
          <ListFilter className="size-3.5" aria-hidden />
          Calendários
          {selectedCount > 0 && (
            <span className="grid min-w-5 place-items-center rounded-pill bg-surface-3 px-1.5 font-mono text-xs font-semibold tabular-nums text-text">
              {selectedCount}
            </span>
          )}
        </button>
      </div>

      {/* Lista rolável de eventos do dia (timeline vertical, §3.9) */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface">
        {noneSelected ? (
          <EmptyState
            icon={CalendarDays}
            title="Nenhum calendário visível"
            description="Escolha quais calendários mostrar para ver os eventos do dia."
            action={
              <Button variant="secondary" size="sm" onClick={() => setRailOpen(true)}>
                Escolher calendários
              </Button>
            }
          />
        ) : eventsQuery.isLoading ? (
          <DaySkeleton />
        ) : eventsQuery.isError ? (
          <ErrorState
            title="Falha ao carregar eventos"
            reason="Não foi possível buscar a agenda deste dia."
            whatToDo="Verifique sua conexão e tente novamente."
            action={
              <Button variant="secondary" size="sm" onClick={() => void eventsQuery.refetch()}>
                Tentar de novo
              </Button>
            }
          />
        ) : events.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Nada agendado"
            description="Nenhum evento para este dia."
            action={
              props.canEdit ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={readOnly}
                  title={readOnly ? READ_ONLY_TOOLTIP : undefined}
                  onClick={createForSelectedDay}
                >
                  Novo evento
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="flex flex-col">
            {events.map((e, index) => (
              <AgendaRow
                key={e.id}
                showNowBefore={isToday && nowIndex === index}
                nowMs={nowMs}
                event={e}
                color={colorByCalendar.get(e.calendarId) ?? 'var(--text-low)'}
                onOpen={() => props.onOpenEvent(e.id)}
              />
            ))}
            {isToday && nowIndex === events.length ? <NowLine nowMs={nowMs} /> : null}
          </ul>
        )}
      </div>

      <MobileCalendarRail
        open={railOpen}
        onClose={() => setRailOpen(false)}
        calendars={calendars}
        members={members}
        myMemberId={myMemberId}
        canSeeOthers={canSeeOthers}
        selection={selection}
      />
    </div>
  );
}

/** Linha "agora": o único elemento com movimento contínuo da Agenda (Signal pulse). */
function NowLine({ nowMs }: { nowMs: number }): React.JSX.Element {
  const time = formatTime(new Date(nowMs).toISOString());
  // `<li>` puro (axe `list`: filho de <ul> não pode trocar de papel); o separador é o
  // filho, com o horário no nome acessível.
  return (
    <li>
      <div
        role="separator"
        aria-label={`Agora, ${time}`}
        className="flex items-center gap-2 px-3 py-1.5"
      >
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-pill bg-brand-text text-brand-text motion-safe:animate-[hm-signal_2s_var(--ease)_infinite]"
        />
        <span
          aria-hidden
          className="font-mono text-xs font-semibold uppercase tracking-wider tabular-nums text-brand-text"
        >
          Agora {time}
        </span>
        <span aria-hidden className="h-px flex-1 bg-brand-text/40" />
      </div>
    </li>
  );
}

function AgendaRow({
  showNowBefore,
  nowMs,
  ...item
}: {
  showNowBefore: boolean;
  nowMs: number;
  event: EventRow;
  color: string;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <>
      {showNowBefore ? <NowLine nowMs={nowMs} /> : null}
      <AgendaItem {...item} />
    </>
  );
}

/**
 * Item da timeline: barra no tom do TIPO (token) + horário em mono + título + meta, com o
 * calendário de origem no pontinho. Corpo clicável (UX §2.1). Ocorrências de série ganham
 * um selo de recorrência.
 */
function AgendaItem({
  event,
  color,
  onOpen,
}: {
  event: EventRow;
  color: string;
  onOpen: () => void;
}): React.JSX.Element {
  const recurring = isOccurrence(event) || Boolean(event.recurrenceRule);
  // F54-S03: o cliente vinculado vira a identidade do item (foto + nome). O título
  // do compromisso fica como subtítulo quando há contato; senão, o título lidera.
  const contact = event.contact ?? null;
  const primary = contact?.name?.trim() || event.title;
  const tone = eventTone(event.type);
  const completed = event.status === 'completed';
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-stretch gap-3 px-3 py-3 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:focus-ring -outline-offset-2"
      >
        {/* Barra vertical no tom do tipo de compromisso. */}
        {/* Concluído recua por COR, não por opacidade (contraste AA nos dois temas):
            barra `text-low`, título riscado em `text-mid`, horário em `text-low`. */}
        <span
          aria-hidden
          data-event-tone={tone.name}
          className={cn('w-1 shrink-0 rounded-pill', completed ? 'bg-text-low' : tone.bar)}
        />
        {contact ? <Avatar src={contact.avatarUrl} name={primary} size="md" /> : null}
        <span className="flex min-w-0 flex-1 flex-col gap-1" data-completed={completed || undefined}>
          <span
            className={cn(
              'flex items-center gap-1.5 font-mono text-xs font-semibold tabular-nums',
              completed ? 'text-text-low' : 'text-text-mid',
            )}
          >
            <Clock className="size-3.5 shrink-0" aria-hidden />
            {formatTime(event.startAt)} – {formatTime(event.endAt)}
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-pill"
              style={{ backgroundColor: color }}
            />
            {recurring && (
              <Repeat className="size-3.5 shrink-0 text-text-low" aria-label="Evento recorrente" />
            )}
          </span>
          <span
            className={cn(
              'truncate font-body text-sm font-bold',
              completed ? 'text-text-mid line-through' : 'text-text',
            )}
          >
            {primary}
          </span>
          {contact ? (
            <span className="truncate font-body text-xs text-text-low">{event.title}</span>
          ) : null}
          {event.location && (
            <span className="flex items-center gap-1.5 truncate font-body text-xs text-text-low">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              {event.location}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function DaySkeleton(): React.JSX.Element {
  return (
    <ul className="flex flex-col" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex items-stretch gap-3 border-b border-border px-3 py-3 last:border-b-0">
          <span className="w-1 shrink-0 rounded-pill bg-surface-3" />
          <span className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-2/3" />
          </span>
        </li>
      ))}
    </ul>
  );
}
