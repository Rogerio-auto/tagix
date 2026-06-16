'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin } from 'lucide-react';
import { Button } from '@hm/ui';
import { EmptyState, ErrorState } from '@/shared/components/feedback';
import { useEvents } from './queries';
import type { EventRow, EventType } from './types';

/** Cores por tipo via tokens DS v2 — zero hex em JSX (espelha CalendarPage). */
const TYPE_COLOR: Record<EventType, string> = {
  meeting: 'var(--brand)',
  demo: 'var(--info)',
  follow_up: 'var(--warn)',
  task: 'var(--brand-soft)',
  reminder: 'var(--success)',
  other: 'var(--text-low)',
};

const TZ = 'America/Sao_Paulo';

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
  return d.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    timeZone: TZ,
  });
}

/** Horário curto "14:30". */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  });
}

export interface MobileAgendaProps {
  readonly calendarId: string;
  readonly canEdit: boolean;
  /** Toque num evento → abre detalhe em sheet. */
  readonly onOpenEvent: (eventId: string) => void;
  /** Criar evento no dia selecionado → abre form em sheet com start/end pré. */
  readonly onCreateForDay: (start: string, end: string) => void;
}

/**
 * Visão agenda/dia para mobile (MOBILE_UX §2 "Calendário", §3.9 timeline vertical).
 * Dia único navegável (anterior/próximo + seletor de data) com timeline vertical
 * de eventos — prioriza escaneabilidade sobre a grade de mês (ruim em tela estreita).
 *
 * Reusa `/api/events` com filtro `from`/`to` do dia selecionado; nenhuma mudança
 * de API. Datas/horas no tz do app (pt-BR / America/Sao_Paulo).
 */
export function MobileAgenda(props: MobileAgendaProps): React.JSX.Element {
  const [day, setDay] = useState<Date>(() => startOfDay(new Date()));

  // Janela do dia selecionado [00:00, 23:59:59.999], em ISO. A API filtra por
  // `events.startAt` (gte from / lte to) — `to` inclusivo no fim do dia evita
  // que um evento das 00:00 do dia seguinte vaze para esta lista.
  const range = useMemo(() => {
    const from = startOfDay(day);
    const to = new Date(addDays(day, 1).getTime() - 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [day]);

  const eventsQuery = useEvents({
    ...(props.calendarId ? { calendarId: props.calendarId } : {}),
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
          className="touch-target grid place-items-center rounded-md border border-border bg-surface-2 text-text-mid outline-none transition-colors hover:text-text focus-visible:shadow-glow-md"
        >
          <ChevronLeft className="size-5" />
        </button>

        <label className="relative flex min-w-0 flex-1 cursor-pointer items-center justify-center rounded-md border border-border bg-surface-2 px-3 text-center">
          <span className="truncate text-sm font-medium text-text first-letter:uppercase">
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
          className="touch-target grid place-items-center rounded-md border border-border bg-surface-2 text-text-mid outline-none transition-colors hover:text-text focus-visible:shadow-glow-md"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      {!isToday && (
        <button
          type="button"
          onClick={() => setDay(today)}
          className="self-start rounded-pill border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-mid outline-none transition-colors hover:text-text focus-visible:shadow-glow-md"
        >
          Hoje
        </button>
      )}

      {/* Lista rolável de eventos do dia (timeline vertical, §3.9) */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface">
        {eventsQuery.isLoading ? (
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
                <Button variant="primary" size="sm" onClick={createForSelectedDay}>
                  Novo evento
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="flex flex-col">
            {events.map((e) => (
              <AgendaItem key={e.id} event={e} onOpen={() => props.onOpenEvent(e.id)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Item da timeline: faixa de cor por tipo + horário + título + meta (UX §2.1: corpo clicável). */
function AgendaItem({
  event,
  onOpen,
}: {
  event: EventRow;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <li className="border-b border-border-2 last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-stretch gap-3 px-3 py-3 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:shadow-glow-md"
      >
        {/* Faixa vertical de cor por tipo */}
        <span
          aria-hidden
          className="w-1 shrink-0 rounded-pill"
          style={{ backgroundColor: TYPE_COLOR[event.type] }}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs font-medium text-text-mid">
            <Clock className="size-3.5 shrink-0" aria-hidden />
            {formatTime(event.startAt)} – {formatTime(event.endAt)}
          </span>
          <span className="truncate text-sm font-medium text-text">{event.title}</span>
          {event.location && (
            <span className="flex items-center gap-1.5 truncate text-xs text-text-low">
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
    <ul className="flex flex-col">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex items-stretch gap-3 border-b border-border-2 px-3 py-3 last:border-b-0">
          <span className="w-1 shrink-0 rounded-pill bg-surface-raised" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3 w-24 animate-pulse rounded-sm bg-surface-raised" />
            <span className="h-4 w-2/3 animate-pulse rounded-sm bg-surface-raised" />
          </span>
        </li>
      ))}
    </ul>
  );
}
