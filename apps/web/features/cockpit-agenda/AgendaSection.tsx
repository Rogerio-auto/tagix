'use client';

/**
 * Card **Agenda / Próximos Compromissos** do Cockpit (F53-S04). É a peça que
 * transforma o painel da conversa em centro de gestão comercial: lista os
 * próximos compromissos do contato, um histórico em timeline, e o atalho
 * "+ Novo Agendamento" (reusa o `QuickScheduleModal` de S03).
 *
 * Reuso (TRAVA DO SLOT):
 *  - `useEvents` / `useCalendars` de features/calendar (read-only) — não duplica consulta.
 *  - `QuickScheduleModal` de features/cockpit-agenda (S03) — não recria o modal.
 *  - `AppointmentDetail` (S04) abre o detalhe em drawer/sheet ao clicar no item.
 *
 * UX (UX_PRINCIPLES.md): §2.1 clique no corpo do item abre o detalhe; §2.3 detalhe
 * em drawer/sheet; §2.6 empty state + CTA (e estado "sem contato" orienta a vincular);
 * §2.7 skeleton no loading + toast nas ações; §3.9 histórico em timeline vertical.
 *
 * DS v2: zero hex hardcoded — só tokens. O verde-neon (`brand`) NÃO é usado aqui
 * (a seção convive com o toggle de IA do cockpit, que já reserva o neon p/ si): o
 * CTA usa `secondary`. Alvos ≥ 44px. Animações < 250ms, `motion-safe`.
 */

import { useMemo, useState } from 'react';
import {
  Bell,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckSquare,
  FileText,
  MessageCircle,
  MonitorPlay,
  Phone,
  Receipt,
  RefreshCw,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@hm/ui';
import { cn } from '@hm/ui/cn';
import { can } from '@hm/shared';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useCalendars, useEvents } from '@/features/calendar/queries';
import type { EventRow } from '@/features/calendar/types';
import { QuickScheduleModal } from './QuickScheduleModal';
import { AppointmentDetail } from './AppointmentDetail';

// ── Vocabulário (espelha o schema F53 — events_*_chk) ─────────────────────────

export type AgendaStatus =
  | 'scheduled'
  | 'confirmed'
  | 'in_progress'
  | 'postponed'
  | 'completed'
  | 'cancelled';

export type AgendaType =
  | 'meeting'
  | 'demo'
  | 'follow_up'
  | 'task'
  | 'reminder'
  | 'other'
  | 'call'
  | 'whatsapp'
  | 'billing'
  | 'proposal'
  | 'custom';

export type AgendaPriority = 'low' | 'medium' | 'high';

/** Estados terminais (entram no histórico, sem transições). */
const TERMINAL: ReadonlySet<AgendaStatus> = new Set<AgendaStatus>(['completed', 'cancelled']);

/** Forma normalizada que a UI consome — derivada do `EventRow` da API. */
export interface AgendaEvent {
  /** Id bruto (sintético `evt:<id>:<iso>` em ocorrências) — chave de lista. */
  readonly id: string;
  /** Id do evento mestre — alvo das mutações (PUT/cancel). */
  readonly masterId: string;
  readonly title: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly status: AgendaStatus;
  readonly type: AgendaType;
  readonly priority: AgendaPriority;
  readonly description: string | null;
  readonly conversationId: string | null;
  /** `startAt` em ms (ordenação barata e estável). */
  readonly startMs: number;
}

const STATUS_VALUES: ReadonlySet<string> = new Set<AgendaStatus>([
  'scheduled',
  'confirmed',
  'in_progress',
  'postponed',
  'completed',
  'cancelled',
]);

const TYPE_VALUES: ReadonlySet<string> = new Set<AgendaType>([
  'meeting',
  'demo',
  'follow_up',
  'task',
  'reminder',
  'other',
  'call',
  'whatsapp',
  'billing',
  'proposal',
  'custom',
]);

export function normalizeStatus(raw: string): AgendaStatus {
  return STATUS_VALUES.has(raw) ? (raw as AgendaStatus) : 'scheduled';
}

export function normalizeType(raw: string): AgendaType {
  return TYPE_VALUES.has(raw) ? (raw as AgendaType) : 'other';
}

export function normalizePriority(raw: unknown): AgendaPriority {
  return raw === 'low' || raw === 'high' || raw === 'medium' ? raw : 'medium';
}

export function isTerminalStatus(status: AgendaStatus): boolean {
  return TERMINAL.has(status);
}

/** Extrai o id do evento MESTRE (ocorrências chegam como `evt:<id>:<iso>`). */
function masterIdOf(row: EventRow): string {
  if (row.recurrenceParentId) return row.recurrenceParentId;
  if (row.id.startsWith('evt:')) {
    const rest = row.id.slice('evt:'.length);
    const sep = rest.indexOf(':');
    return sep > 0 ? rest.slice(0, sep) : rest;
  }
  return row.id;
}

/**
 * Mapeia um `EventRow` (tipos `type`/`status` ainda estreitos em features/calendar;
 * `priority` ausente no tipo web) para o `AgendaEvent` da UI. A API (F53-S02) já
 * persiste e devolve os tipos comerciais, os novos status e a `priority`; lemos de
 * forma defensiva sem tocar em features/calendar (fronteira proibida do slot).
 */
export function toAgendaEvent(row: EventRow): AgendaEvent {
  const priorityRaw = (row as { priority?: unknown }).priority;
  return {
    id: row.id,
    masterId: masterIdOf(row),
    title: row.title,
    startAt: row.startAt,
    endAt: row.endAt,
    status: normalizeStatus(row.status),
    type: normalizeType(row.type),
    priority: normalizePriority(priorityRaw),
    description: row.description,
    conversationId: row.conversationId,
    startMs: new Date(row.startAt).getTime(),
  };
}

/**
 * Separa os eventos em **próximos** (status não-terminal, ordem crescente — o mais
 * iminente primeiro) e **histórico** (terminal, ordem decrescente — o mais recente
 * no topo da timeline).
 */
export function partitionAgendaEvents(items: readonly AgendaEvent[]): {
  upcoming: AgendaEvent[];
  history: AgendaEvent[];
} {
  const upcoming: AgendaEvent[] = [];
  const history: AgendaEvent[] = [];
  for (const item of items) {
    if (isTerminalStatus(item.status)) history.push(item);
    else upcoming.push(item);
  }
  upcoming.sort((a, b) => a.startMs - b.startMs);
  history.sort((a, b) => b.startMs - a.startMs);
  return { upcoming, history };
}

// ── Rótulos / ícones (PT-BR) ──────────────────────────────────────────────────

const STATUS_LABEL: Record<AgendaStatus, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  in_progress: 'Em andamento',
  postponed: 'Adiado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

const PRIORITY_LABEL: Record<AgendaPriority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
};

const TYPE_LABEL: Record<AgendaType, string> = {
  meeting: 'Reunião',
  demo: 'Demonstração',
  follow_up: 'Follow-up',
  task: 'Tarefa',
  reminder: 'Lembrete',
  other: 'Compromisso',
  call: 'Ligação',
  whatsapp: 'WhatsApp',
  billing: 'Cobrança',
  proposal: 'Proposta',
  custom: 'Personalizado',
};

const TYPE_ICON: Record<AgendaType, LucideIcon> = {
  meeting: Users,
  demo: MonitorPlay,
  follow_up: RefreshCw,
  task: CheckSquare,
  reminder: Bell,
  other: CalendarClock,
  call: Phone,
  whatsapp: MessageCircle,
  billing: Receipt,
  proposal: FileText,
  custom: CalendarClock,
};

export function statusLabel(status: AgendaStatus): string {
  return STATUS_LABEL[status];
}
export function priorityLabel(priority: AgendaPriority): string {
  return PRIORITY_LABEL[priority];
}
export function typeLabel(type: AgendaType): string {
  return TYPE_LABEL[type];
}
export function typeIcon(type: AgendaType): LucideIcon {
  return TYPE_ICON[type];
}

/** Classe (tokens DS v2) do badge de status. */
export function statusBadgeClass(status: AgendaStatus): string {
  switch (status) {
    case 'confirmed':
      return 'border-success/30 bg-success/10 text-success';
    case 'in_progress':
      return 'border-warn/30 bg-warn/10 text-warn';
    case 'postponed':
      return 'border-border-2 bg-surface-3 text-text-mid';
    case 'completed':
      return 'border-success/30 bg-success/10 text-success';
    case 'cancelled':
      return 'border-danger/30 bg-danger/10 text-danger';
    case 'scheduled':
    default:
      return 'border-border-2 bg-surface-3 text-text-low';
  }
}

/** Classe (tokens DS v2) do badge de prioridade. `medium` é discreto (sem ruído). */
export function priorityBadgeClass(priority: AgendaPriority): string {
  switch (priority) {
    case 'high':
      return 'border-danger/30 bg-danger/10 text-danger';
    case 'medium':
      return 'border-border-2 bg-surface-3 text-text-mid';
    case 'low':
    default:
      return 'border-border-2 bg-surface-3 text-text-low';
  }
}

// ── Formatação de data relativa ───────────────────────────────────────────────

const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "Hoje" / "Amanhã" / "Ontem" / "Sexta" / "12 jul" relativo a `now`. */
export function formatRelativeDay(date: Date, now: Date): string {
  const diff = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  if (diff === -1) return 'Ontem';
  if (diff > 1 && diff < 7) return capitalize(date.toLocaleDateString('pt-BR', { weekday: 'long' }));
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** "Amanhã • 09:00" — base do rótulo do item (o título vem depois). */
export function formatWhen(startAtISO: string, now: Date): string {
  const d = new Date(startAtISO);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatRelativeDay(d, now)} • ${formatClock(d)}`;
}

// ── Wrapper visual (espelha o Card/Section do cockpit, sem importar privados) ──

function SectionShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-md border border-border-2 bg-surface-2 p-4 shadow-elev-1">
      <header className="mb-3 flex items-center gap-2">
        <CalendarClock className="size-4 text-text-low" aria-hidden />
        <h3 className="font-head text-sm font-semibold text-text">Agenda</h3>
      </header>
      {children}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export interface AgendaSectionProps {
  /** Contato vinculado à conversa (ou `null` quando não há contato). */
  readonly contactId: string | null;
  /** Conversa de origem — pré-preenche o agendamento e ancora "Abrir conversa". */
  readonly conversationId: string;
}

export function AgendaSection({ contactId, conversationId }: AgendaSectionProps): React.JSX.Element | null {
  const role = useAuthStore((s) => s.auth?.role ?? null);
  const canView = role ? can(role, 'calendar.view') : false;
  const canEdit = role ? can(role, 'event.edit') : false;
  const { isMobile } = useBreakpoint();

  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<AgendaEvent | null>(null);

  // Janela ESTÁVEL por montagem: [-90d, +90d]. O passado alimenta o histórico
  // (eventos terminais são, por definição, atrás de "agora"); o futuro, os próximos.
  const now = useMemo(() => new Date(), []);
  const range = useMemo(() => {
    const from = new Date(now.getTime() - 90 * DAY_MS).toISOString();
    const to = new Date(now.getTime() + 90 * DAY_MS).toISOString();
    return { from, to };
  }, [now]);

  const calendarsQ = useCalendars();
  const calendarIds = useMemo(
    () => (calendarsQ.data?.calendars ?? []).map((c) => c.id),
    [calendarsQ.data],
  );

  // `useEvents` só busca com calendários (interseção pedido ∩ acessível na API).
  // Sem contato não há o que listar — mandamos `[]` e a query fica desabilitada.
  const eventsQ = useEvents({
    calendarIds: contactId ? calendarIds : [],
    contactId: contactId ?? undefined,
    from: range.from,
    to: range.to,
  });

  const { upcoming, history } = useMemo(() => {
    const rows = eventsQ.data?.events ?? [];
    return partitionAgendaEvents(rows.map(toAgendaEvent));
  }, [eventsQ.data]);

  if (!canView) return null;

  // Sem contato vinculado: orienta a vincular (UX §2.6, estado sem-dados acionável).
  if (!contactId) {
    return (
      <SectionShell>
        <p className="font-body text-sm text-text-low">
          Vincule um contato a esta conversa para ver e criar compromissos da agenda.
        </p>
      </SectionShell>
    );
  }

  const isLoading = calendarsQ.isLoading || eventsQ.isLoading;
  const isError = calendarsQ.isError || eventsQ.isError;
  const isEmpty = !isLoading && !isError && upcoming.length === 0 && history.length === 0;

  return (
    <SectionShell>
      {isLoading ? (
        <div className="space-y-2" aria-hidden>
          <div className="h-12 w-full animate-pulse rounded-md bg-surface-3" />
          <div className="h-12 w-full animate-pulse rounded-md bg-surface-3" />
        </div>
      ) : isError ? (
        // Erro em 3 partes (o quê / porquê / o que fazer) — UX §2.11.
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5"
        >
          <span className="font-body text-sm font-medium text-text">
            Não foi possível carregar a agenda
          </span>
          <span className="font-body text-xs text-text-mid">
            A conexão com o servidor falhou ao buscar os compromissos.
          </span>
          <button
            type="button"
            onClick={() => void eventsQ.refetch()}
            className="mt-1 self-start rounded-sm font-body text-xs font-medium text-text underline-offset-2 outline-none hover:underline focus-visible:shadow-glow-md"
          >
            Tentar novamente
          </button>
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CalendarClock className="size-8 text-text-low" aria-hidden />
          <p className="font-body text-sm text-text-mid">Nenhum compromisso agendado</p>
          {canEdit ? (
            <Button
              type="button"
              size={isMobile ? 'lg' : 'sm'}
              variant="secondary"
              leftIcon={<CalendarPlus className="size-3.5" aria-hidden />}
              onClick={() => setModalOpen(true)}
            >
              Novo Agendamento
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Próximos */}
          {upcoming.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {upcoming.map((event) => (
                <li key={event.id}>
                  <UpcomingItem event={event} now={now} onOpen={() => setSelected(event)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-body text-xs text-text-low">Nenhum compromisso futuro.</p>
          )}

          {/* + Novo Agendamento (gated event.edit) */}
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="self-start"
              leftIcon={<CalendarPlus className="size-3.5" aria-hidden />}
              onClick={() => setModalOpen(true)}
            >
              Novo Agendamento
            </Button>
          ) : null}

          {/* Histórico — timeline vertical (UX §3.9) */}
          {history.length > 0 ? (
            <HistoryTimeline items={history} now={now} onOpen={setSelected} />
          ) : null}
        </div>
      )}

      {/* Modal de agendamento rápido (S03) — pré-preenchido com contato/conversa.
          `useCreateEvent` invalida a query ['events'] no sucesso → a lista atualiza. */}
      <QuickScheduleModal
        open={modalOpen}
        contactId={contactId}
        conversationId={conversationId}
        onClose={() => setModalOpen(false)}
      />

      {/* Detalhe do compromisso em drawer/sheet (UX §2.3) */}
      <AppointmentDetail
        event={selected}
        open={selected !== null}
        canEdit={canEdit}
        onClose={() => setSelected(null)}
      />
    </SectionShell>
  );
}

// ── Item de "próximos" ────────────────────────────────────────────────────────

function UpcomingItem({
  event,
  now,
  onOpen,
}: {
  event: AgendaEvent;
  now: Date;
  onOpen: () => void;
}): React.JSX.Element {
  const Icon = TYPE_ICON[event.type];
  const when = formatWhen(event.startAt, now);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${when} • ${event.title} — abrir detalhe`}
      className={cn(
        'flex w-full items-start gap-3 rounded-md border border-border-2 bg-surface px-3 py-2.5 text-left',
        'outline-none transition-colors duration-200 hover:border-border hover:bg-surface-3',
        'focus-visible:shadow-glow-md',
      )}
    >
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-surface-3 text-text-mid">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-xs text-text-low">{when}</span>
        <span className="block truncate font-body text-sm font-medium text-text">{event.title}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge className={statusBadgeClass(event.status)}>{statusLabel(event.status)}</Badge>
          {event.priority !== 'low' ? (
            <Badge className={priorityBadgeClass(event.priority)}>
              {priorityLabel(event.priority)}
            </Badge>
          ) : null}
        </span>
      </span>
    </button>
  );
}

// ── Timeline de histórico (UX §3.9) ───────────────────────────────────────────

function HistoryTimeline({
  items,
  now,
  onOpen,
}: {
  items: readonly AgendaEvent[];
  now: Date;
  onOpen: (event: AgendaEvent) => void;
}): React.JSX.Element {
  return (
    <div className="border-t border-border-2 pt-3">
      <h4 className="mb-2 font-body text-xs font-semibold uppercase tracking-wide text-text-low">
        Histórico
      </h4>
      <ol className="relative flex flex-col gap-3 pl-5">
        {/* Trilho vertical da timeline. */}
        <span
          aria-hidden
          className="absolute left-[7px] top-1 bottom-1 w-px bg-border-2"
        />
        {items.map((event) => {
          const done = event.status === 'completed';
          const when = formatWhen(event.startAt, now);
          return (
            <li key={event.id} className="relative">
              <span
                aria-hidden
                className={cn(
                  'absolute -left-5 top-0.5 grid size-3.5 place-items-center rounded-full ring-2 ring-surface-2',
                  done ? 'bg-success/20 text-success' : 'bg-surface-3 text-text-low',
                )}
              >
                {done ? <Check className="size-2.5" aria-hidden /> : null}
              </span>
              <button
                type="button"
                onClick={() => onOpen(event)}
                aria-label={`${when} • ${event.title} — abrir detalhe`}
                className="flex w-full flex-col rounded-sm text-left outline-none focus-visible:shadow-glow-md"
              >
                <span className="truncate font-body text-sm text-text-mid">{event.title}</span>
                <span className="font-body text-xs text-text-low">
                  {when} • {statusLabel(event.status)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

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
