'use client';

/**
 * Visão "Lista" da Agenda Central (F54-S03) — a Agenda como extensão viva do
 * Cockpit. Lista de follow-ups **agrupada por dia** (vencidos e hoje em destaque),
 * cada item um **cartão do cliente** (foto/nome/telefone/tipo/prioridade/status/
 * descrição) com ações rápidas.
 *
 * UX (UX_PRINCIPLES.md): §2.1 corpo do item clicável abre o detalhe; §2.3 detalhe/
 * ações em drawer/sheet (reusa `AppointmentDetail` de cockpit-agenda); §2.7 feedback
 * imediato (botões loading + toast); §2.9 cancelar com confirmação proporcional
 * (passo duplo inline); §3.9 agrupamento cronológico vertical relativo a "agora".
 *
 * Reuso (fronteira respeitada — só IMPORT de cockpit-agenda): `Avatar` (@hm/ui),
 * `AppointmentDetail` + helpers de rótulo/badge/ícone de `AgendaSection`. Mutações
 * via `useUpdateEvent`/`useCancelEvent` de features/calendar. Zero hex — só tokens.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  Check,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  X,
} from 'lucide-react';
import { Avatar, Button, useToast } from '@hm/ui';
import { cn } from '@hm/ui/cn';
import { EmptyState, ErrorState } from '@/shared/components/feedback';
import { AppointmentDetail } from '@/features/cockpit-agenda/AppointmentDetail';
import {
  normalizePriority,
  priorityBadgeClass,
  priorityLabel,
  statusBadgeClass,
  statusLabel,
  toAgendaEvent,
  typeIcon,
  typeLabel,
} from '@/features/cockpit-agenda/AgendaSection';
import { useCancelEvent, useEvents, useUpdateEvent } from './queries';
import { buildAgendaList, isTerminalStatus, type DayRelative } from './agendaList';
import { isOccurrence, masterEventId, type EventRow } from './types';

const DAY_MS = 86_400_000;

/** Prefixo de destaque por posição do dia (UX: HOJE/AMANHÃ/ONTEM ganham rótulo). */
const DAY_PREFIX: Partial<Record<DayRelative, string>> = {
  today: 'HOJE',
  tomorrow: 'AMANHÃ',
  yesterday: 'ONTEM',
};

/** "qui 28 jun" (weekday curto + dia + mês curto), sem pontos abreviativos. */
function formatDate(dayMs: number): string {
  const d = new Date(dayMs);
  const wd = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace(/\.$/, '');
  const mo = d.toLocaleDateString('pt-BR', { month: 'short' }).replace(/\.$/, '');
  return `${wd} ${d.getDate()} ${mo}`;
}

/** "09:00". */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export interface AgendaListViewProps {
  /** Calendários SELECIONADOS e acessíveis (overlay) — mesma fonte da grade. */
  readonly calendarIds: readonly string[];
  /** `true` enquanto a seleção persistida ainda não hidratou (evita "vazio" falso). */
  readonly selectionHydrated: boolean;
  /** `event.edit` — habilita Concluir/Reagendar/Editar/Cancelar. */
  readonly canEdit: boolean;
  /** id calendarId → cor (DATA da API) para o ponto de horário de cada item. */
  readonly colorByCalendar: Map<string, string>;
  /** Abre o `EventForm` para editar o evento (recurso da `CalendarPage`). */
  readonly onEdit: (event: EventRow) => void;
}

export function AgendaListView(props: AgendaListViewProps): React.JSX.Element {
  const { calendarIds, selectionHydrated, canEdit, colorByCalendar, onEdit } = props;
  const { toast } = useToast();
  const router = useRouter();

  // Janela ampla e ESTÁVEL por montagem: [-7d, +60d]. O passado alimenta os vencidos;
  // o futuro, os próximos. O ouvinte de tempo real (S02) invalida e refaz o fetch.
  const nowMs = useMemo(() => Date.now(), []);
  const range = useMemo(
    () => ({
      from: new Date(nowMs - 7 * DAY_MS).toISOString(),
      to: new Date(nowMs + 60 * DAY_MS).toISOString(),
    }),
    [nowMs],
  );

  const eventsQuery = useEvents({ calendarIds, from: range.from, to: range.to });
  const groups = useMemo(
    () => buildAgendaList(eventsQuery.data?.events ?? [], nowMs),
    [eventsQuery.data, nowMs],
  );

  // Detalhe em drawer/sheet (reuso de cockpit-agenda) — também é o destino de "Reagendar".
  const [selected, setSelected] = useState<EventRow | null>(null);
  const selectedAgenda = useMemo(() => (selected ? toAgendaEvent(selected) : null), [selected]);

  // Confirmação de cancelamento por item (passo duplo, UX §2.9) e id em ação (loading).
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const update = useUpdateEvent();
  const cancel = useCancelEvent();

  function complete(row: EventRow): void {
    setActingId(row.id);
    update.mutate(
      { id: masterEventId(row), patch: { status: 'completed' } },
      {
        onSuccess: () => toast({ variant: 'success', title: 'Compromisso concluído.' }),
        onError: (e) => toast({ variant: 'error', title: e.message }),
        onSettled: () => setActingId(null),
      },
    );
  }

  function doCancel(row: EventRow): void {
    setActingId(row.id);
    cancel.mutate(masterEventId(row), {
      onSuccess: () => {
        toast({ variant: 'success', title: 'Compromisso cancelado.' });
        setConfirmingId(null);
      },
      onError: (e) => toast({ variant: 'error', title: e.message }),
      onSettled: () => setActingId(null),
    });
  }

  function openConversation(row: EventRow): void {
    if (!row.conversationId) return;
    // O LiveChat (desktop) abre a conversa JÁ com o cockpit/painel direito ao lado —
    // não há rota separada p/ o painel, então "abrir conversa" == "abrir no cockpit".
    router.push(`/conversations/${row.conversationId}`);
  }

  // ── Estados de borda ────────────────────────────────────────────────────────
  if (selectionHydrated && calendarIds.length === 0) {
    return (
      <ListShell>
        <EmptyState
          icon={CalendarDays}
          title="Nenhum calendário visível"
          description="Ligue ao menos um calendário na trilha à esquerda para ver os follow-ups."
        />
      </ListShell>
    );
  }

  if (eventsQuery.isLoading) {
    return (
      <ListShell>
        <ListSkeleton />
      </ListShell>
    );
  }

  if (eventsQuery.isError) {
    return (
      <ListShell>
        <ErrorState
          title="Não foi possível carregar a agenda"
          reason="A conexão com o servidor falhou ao buscar os compromissos."
          whatToDo="Verifique sua conexão e tente novamente."
          action={
            <Button variant="secondary" size="sm" onClick={() => void eventsQuery.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      </ListShell>
    );
  }

  if (groups.length === 0) {
    return (
      <ListShell>
        <EmptyState
          icon={CalendarClock}
          title="Nada na agenda"
          description="Nenhum follow-up vencido, para hoje ou nos próximos dias."
        />
      </ListShell>
    );
  }

  return (
    <div className="hm-agenda-list min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface p-3 sm:p-4">
      <ol className="flex flex-col gap-6">
        {groups.map((group) => (
          <li key={group.key}>
            <DayHeading relative={group.relative} dayMs={group.dayMs} overdue={group.overdue} />
            <ul className="mt-3 flex flex-col gap-2">
              {group.items.map((item) => (
                <li key={item.event.id}>
                  <AgendaItemCard
                    event={item.event}
                    overdue={item.overdue}
                    today={group.relative === 'today'}
                    canEdit={canEdit}
                    color={colorByCalendar.get(item.event.calendarId) ?? 'var(--text-low)'}
                    acting={actingId === item.event.id}
                    confirming={confirmingId === item.event.id}
                    onOpen={() => setSelected(item.event)}
                    onOpenConversation={() => openConversation(item.event)}
                    onComplete={() => complete(item.event)}
                    onEdit={() => onEdit(item.event)}
                    onReschedule={() => setSelected(item.event)}
                    onAskCancel={() => setConfirmingId(item.event.id)}
                    onConfirmCancel={() => doCancel(item.event)}
                    onAbortCancel={() => setConfirmingId(null)}
                  />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {/* Detalhe + ações (Iniciar/Concluir/Adiar/Cancelar/Abrir conversa) em drawer/sheet. */}
      <AppointmentDetail
        event={selectedAgenda}
        open={selected !== null}
        canEdit={canEdit}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

// ── Cabeçalho de dia ──────────────────────────────────────────────────────────

function DayHeading({
  relative,
  dayMs,
  overdue,
}: {
  relative: DayRelative;
  dayMs: number;
  overdue: boolean;
}): React.JSX.Element {
  const prefix = DAY_PREFIX[relative];
  const isPast = relative === 'past' || relative === 'yesterday';
  return (
    <div className="flex items-center gap-3">
      <h2 className="flex items-baseline gap-2">
        {prefix ? (
          <span
            className={cn(
              'font-head text-sm font-semibold uppercase tracking-wide',
              relative === 'today' ? 'text-text' : isPast ? 'text-danger' : 'text-text-mid',
            )}
          >
            {prefix}
          </span>
        ) : null}
        <span
          className={cn(
            'font-body text-sm capitalize',
            relative === 'today' ? 'text-text-mid' : 'text-text-low',
          )}
        >
          {prefix ? '· ' : ''}
          {formatDate(dayMs)}
        </span>
      </h2>
      <span aria-hidden className="h-px flex-1 bg-border-2" />
      {overdue ? (
        <span className="inline-flex items-center gap-1 font-body text-xs font-medium text-danger">
          <AlertTriangle className="size-3.5" aria-hidden />
          vencidos
        </span>
      ) : null}
    </div>
  );
}

// ── Cartão do item ──────────────────────────────────────────────────────────

interface AgendaItemCardProps {
  readonly event: EventRow;
  readonly overdue: boolean;
  readonly today: boolean;
  readonly canEdit: boolean;
  readonly color: string;
  readonly acting: boolean;
  readonly confirming: boolean;
  readonly onOpen: () => void;
  readonly onOpenConversation: () => void;
  readonly onComplete: () => void;
  readonly onEdit: () => void;
  readonly onReschedule: () => void;
  readonly onAskCancel: () => void;
  readonly onConfirmCancel: () => void;
  readonly onAbortCancel: () => void;
}

function AgendaItemCard(props: AgendaItemCardProps): React.JSX.Element {
  const { event, overdue, today, canEdit, color, acting, confirming } = props;
  const status = event.status;
  const priority = normalizePriority(event.priority);
  const terminal = isTerminalStatus(status);
  const TypeIcon = typeIcon(event.type);
  const name = event.contact?.name?.trim() || event.title;
  const phone = event.contact?.phone?.trim() || null;

  return (
    <article
      className={cn(
        'rounded-lg border transition-colors duration-150',
        overdue
          ? 'border-danger/30 bg-danger/5'
          : today
            ? 'border-border bg-surface-2'
            : 'border-border-2 bg-surface',
      )}
    >
      <button
        type="button"
        onClick={props.onOpen}
        aria-label={`${formatTime(event.startAt)} — ${name}. Abrir detalhe.`}
        className="flex w-full items-start gap-3 rounded-t-lg px-3 py-3 text-left outline-none transition-colors duration-150 hover:bg-surface-2/60 focus-visible:shadow-glow-md"
      >
        {/* Horário com ponto colorido pelo calendário (DATA → style inline). */}
        <span className="flex w-12 shrink-0 flex-col items-center gap-1 pt-0.5">
          <span
            aria-hidden
            className="size-2 rounded-pill"
            style={{ backgroundColor: color }}
          />
          <span className="font-body text-xs font-medium tabular-nums text-text-mid">
            {formatTime(event.startAt)}
          </span>
        </span>

        <Avatar src={event.contact?.avatarUrl} name={name} size="md" />

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-head text-sm font-semibold text-text">{name}</span>
            {overdue ? (
              <span className="inline-flex items-center gap-1 rounded-pill border border-danger/30 bg-danger/10 px-2 py-0.5 font-body text-[0.6875rem] font-semibold uppercase leading-none text-danger">
                <AlertTriangle className="size-3" aria-hidden />
                Vencido
              </span>
            ) : null}
            <Badge className={statusBadgeClass(status)}>{statusLabel(status)}</Badge>
          </span>

          <span className="flex items-center gap-1.5 font-body text-xs text-text-low">
            <TypeIcon className="size-3.5 shrink-0" aria-hidden />
            <span>{typeLabel(event.type)}</span>
            <span aria-hidden>·</span>
            <Badge className={priorityBadgeClass(priority)}>{priorityLabel(priority)}</Badge>
          </span>

          {phone ? (
            <span className="truncate font-body text-xs text-text-low">{phone}</span>
          ) : null}
          {event.description ? (
            <span className="truncate font-body text-sm italic text-text-mid">
              “{event.description}”
            </span>
          ) : null}
        </span>
      </button>

      {/* Ações rápidas (siblings do corpo p/ não aninhar botões). */}
      {confirming ? (
        <div className="flex flex-col gap-2 border-t border-danger/30 px-3 py-2.5">
          <span className="font-body text-xs text-text-mid">
            Cancelar este compromisso? Esta ação não pode ser desfeita.
          </span>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={acting} onClick={props.onAbortCancel}>
              Voltar
            </Button>
            <Button type="button" size="sm" variant="danger" loading={acting} onClick={props.onConfirmCancel}>
              Cancelar compromisso
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-t border-border-2 px-3 py-2">
          {event.conversationId ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              leftIcon={<MessageSquare className="size-3.5" aria-hidden />}
              disabled={acting}
              onClick={props.onOpenConversation}
            >
              Abrir conversa
            </Button>
          ) : null}
          {canEdit && !terminal ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              leftIcon={<Check className="size-3.5" aria-hidden />}
              loading={acting}
              onClick={props.onComplete}
            >
              Concluir
            </Button>
          ) : null}
          {canEdit ? (
            <RowMenu
              disabled={acting}
              items={[
                ...(isOccurrence(event)
                  ? []
                  : [{ key: 'edit', label: 'Editar', icon: Pencil, onSelect: props.onEdit }]),
                {
                  key: 'reschedule',
                  label: 'Reagendar',
                  icon: CalendarClock,
                  onSelect: props.onReschedule,
                },
                ...(terminal
                  ? []
                  : [{ key: 'cancel', label: 'Cancelar', icon: X, danger: true, onSelect: props.onAskCancel }]),
              ]}
            />
          ) : null}
        </div>
      )}
    </article>
  );
}

// ── Menu de ações secundárias (⋯) ─────────────────────────────────────────────

interface RowMenuItem {
  readonly key: string;
  readonly label: string;
  readonly icon: typeof Pencil;
  readonly onSelect: () => void;
  readonly danger?: boolean;
}

function RowMenu({
  items,
  disabled,
}: {
  items: readonly RowMenuItem[];
  disabled?: boolean;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Mais ações"
        onClick={() => setOpen((v) => !v)}
        className="flex size-9 items-center justify-center rounded-md text-text-low outline-none transition-colors duration-150 hover:bg-surface-3 hover:text-text focus-visible:shadow-glow-md disabled:opacity-50"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-44 overflow-hidden rounded-md border border-border-2 bg-surface-raised shadow-elev-2 motion-safe:animate-[hm-fade-in_150ms_ease-out]"
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2.5 text-left font-body text-sm outline-none transition-colors duration-150 focus-visible:bg-surface-3',
                  item.danger
                    ? 'text-danger hover:bg-danger/10'
                    : 'text-text-mid hover:bg-surface-3 hover:text-text',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ── Primitivos visuais ────────────────────────────────────────────────────────

function Badge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill border px-2 py-0.5 font-body text-[0.6875rem] font-medium leading-none',
        className,
      )}
    >
      {children}
    </span>
  );
}

function ListShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-border bg-surface p-6">
      {children}
    </div>
  );
}

function ListSkeleton(): React.JSX.Element {
  return (
    <ul className="w-full max-w-2xl space-y-3" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="flex items-start gap-3 rounded-lg border border-border-2 bg-surface p-3">
          <span className="h-10 w-12 shrink-0 animate-pulse rounded-md bg-surface-3" />
          <span className="size-10 shrink-0 animate-pulse rounded-pill bg-surface-3" />
          <span className="flex flex-1 flex-col gap-2 pt-1">
            <span className="h-3 w-1/3 animate-pulse rounded-sm bg-surface-3" />
            <span className="h-3 w-1/4 animate-pulse rounded-sm bg-surface-3" />
            <span className="h-3 w-2/3 animate-pulse rounded-sm bg-surface-3" />
          </span>
        </li>
      ))}
    </ul>
  );
}
