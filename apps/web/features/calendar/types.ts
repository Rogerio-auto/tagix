/** Tipos da feature de agenda. Calendar 2.0 (F37): multi-calendário + recorrência. */

export type CalendarType = 'personal' | 'team' | 'workspace';

export type EventType = 'meeting' | 'demo' | 'follow_up' | 'task' | 'reminder' | 'other';

export type EventStatus = 'scheduled' | 'confirmed' | 'cancelled' | 'completed';

export interface CalendarRow {
  id: string;
  workspaceId: string;
  name: string;
  type: CalendarType;
  ownerId: string | null;
  teamId: string | null;
  /** Hex `#RRGGBB` vindo da API (DATA, não literal de JSX). Cor da trilha + eventos. */
  color: string;
  description: string | null;
  timezone: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface EventRow {
  id: string;
  workspaceId: string;
  calendarId: string;
  title: string;
  description: string | null;
  type: EventType;
  startAt: string;
  endAt: string;
  status: EventStatus;
  location: string | null;
  meetingUrl: string | null;
  contactId: string | null;
  dealId: string | null;
  conversationId: string | null;
  createdBy: string | null;
  createdByAgentId: string | null;
  /** RRULE simplificado (FREQ=DAILY|WEEKLY[;INTERVAL=n][;BYDAY=...][;UNTIL=ISO]). */
  recurrenceRule: string | null;
  /** Limite da série (coluna), independente do UNTIL embutido na regra. */
  recurrenceUntil: string | null;
  /**
   * Em uma OCORRÊNCIA expandida de uma série, aponta o evento mestre. `null` no mestre
   * e em eventos simples. A API entrega ocorrências com id sintético `evt:<id>:<startISO>`.
   */
  recurrenceParentId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string | null;
}

export interface EventParticipantRow {
  id: string;
  eventId: string;
  memberId: string | null;
  contactId: string | null;
  role: 'organizer' | 'attendee';
  rsvp: 'pending' | 'accepted' | 'declined' | 'tentative' | null;
  notifiedAt: string | null;
}

/** Membro mínimo para o seletor de participantes (espelha `GET /api/members`). */
export interface CalendarMember {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

export interface CreateEventInput {
  calendarId: string;
  title: string;
  startAt: string; // ISO com offset
  endAt: string;
  type?: EventType;
  description?: string | null;
  location?: string | null;
  meetingUrl?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  memberIds?: string[];
  recurrenceRule?: string | null;
  recurrenceUntil?: string | null;
}

export interface UpdateEventInput {
  title?: string;
  startAt?: string;
  endAt?: string;
  type?: EventType;
  status?: Exclude<EventStatus, 'cancelled'>;
  description?: string | null;
  location?: string | null;
  meetingUrl?: string | null;
  recurrenceRule?: string | null;
  recurrenceUntil?: string | null;
}

// ─── Recorrência (form 2.0) ───────────────────────────────────────────────────

/** Presets de recorrência expostos no form. `custom` deriva BYDAY de `weekDays`. */
export type RecurrenceMode = 'none' | 'daily' | 'weekly' | 'weekdays' | 'custom';

/** Códigos RRULE de dia da semana, em ordem (Dom..Sáb). */
export const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

// ─── Helpers de recorrência (puros, partilhados desktop/mobile) ───────────────

/**
 * Extrai o id do evento MESTRE de um id (sintético ou não). Ocorrências chegam como
 * `evt:<masterId>:<occurrenceStartISO>` — abrir/editar sempre opera sobre `<masterId>`.
 */
export function masterEventId(event: Pick<EventRow, 'id' | 'recurrenceParentId'>): string {
  if (event.recurrenceParentId) return event.recurrenceParentId;
  if (event.id.startsWith('evt:')) {
    const rest = event.id.slice('evt:'.length);
    const sep = rest.indexOf(':');
    return sep > 0 ? rest.slice(0, sep) : rest;
  }
  return event.id;
}

/** `true` se o evento é uma ocorrência de uma série (não o mestre). */
export function isOccurrence(event: Pick<EventRow, 'id' | 'recurrenceParentId'>): boolean {
  return Boolean(event.recurrenceParentId) || event.id.startsWith('evt:');
}

/** Monta um RRULE a partir do modo + dias selecionados + data limite. `null` = não repete. */
export function buildRecurrenceRule(input: {
  mode: RecurrenceMode;
  weekDays: readonly WeekdayCode[];
  until: string | null;
}): string | null {
  const { mode, weekDays, until } = input;
  if (mode === 'none') return null;
  const untilPart = until ? `;UNTIL=${until}` : '';
  if (mode === 'daily') return `FREQ=DAILY${untilPart}`;
  if (mode === 'weekly') return `FREQ=WEEKLY${untilPart}`;
  if (mode === 'weekdays') return `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR${untilPart}`;
  // custom
  const ordered = WEEKDAY_CODES.filter((c) => weekDays.includes(c));
  if (ordered.length === 0) return `FREQ=WEEKLY${untilPart}`;
  return `FREQ=WEEKLY;BYDAY=${ordered.join(',')}${untilPart}`;
}

/** Faz o parse de um RRULE em modo + dias para reidratar o form na edição. */
export function parseRecurrenceForForm(rule: string | null): {
  mode: RecurrenceMode;
  weekDays: WeekdayCode[];
} {
  if (!rule) return { mode: 'none', weekDays: [] };
  const parts = new Map<string, string>();
  for (const seg of rule.split(';')) {
    const eq = seg.indexOf('=');
    if (eq <= 0) continue;
    parts.set(seg.slice(0, eq).trim().toUpperCase(), seg.slice(eq + 1).trim());
  }
  const freq = parts.get('FREQ')?.toUpperCase();
  if (freq === 'DAILY') return { mode: 'daily', weekDays: [] };
  if (freq !== 'WEEKLY') return { mode: 'none', weekDays: [] };
  const byDay = parts.get('BYDAY');
  if (!byDay) return { mode: 'weekly', weekDays: [] };
  const days = byDay
    .split(',')
    .map((d) => d.trim().toUpperCase())
    .filter((d): d is WeekdayCode => (WEEKDAY_CODES as readonly string[]).includes(d));
  const isWeekdays =
    days.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every((d) => days.includes(d as WeekdayCode));
  if (isWeekdays) return { mode: 'weekdays', weekDays: days };
  return { mode: 'custom', weekDays: days };
}

/** Descrição legível de um RRULE (PT-BR) para o detalhe do evento. */
export function describeRecurrence(rule: string | null, until: string | null): string | null {
  if (!rule) return null;
  const { mode, weekDays } = parseRecurrenceForForm(rule);
  const dayLabels: Record<WeekdayCode, string> = {
    SU: 'dom',
    MO: 'seg',
    TU: 'ter',
    WE: 'qua',
    TH: 'qui',
    FR: 'sex',
    SA: 'sáb',
  };
  let base: string;
  if (mode === 'daily') base = 'Todos os dias';
  else if (mode === 'weekly') base = 'Toda semana';
  else if (mode === 'weekdays') base = 'Em dias úteis (seg–sex)';
  else if (mode === 'custom')
    base = `Semanalmente: ${WEEKDAY_CODES.filter((c) => weekDays.includes(c))
      .map((c) => dayLabels[c])
      .join(', ')}`;
  else return null;

  // UNTIL embutido na regra OU coluna recurrenceUntil.
  const untilMatch = /UNTIL=([^;]+)/.exec(rule);
  const untilIso = untilMatch?.[1] ?? until ?? null;
  if (untilIso) {
    const d = new Date(untilIso);
    if (!Number.isNaN(d.getTime())) {
      base += `, até ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}`;
    }
  }
  return base;
}
