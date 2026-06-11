/**
 * Event service (CALENDAR.md §4.3, §6). Ponto ÚNICO de criação/cancelamento de
 * eventos — reusado pela API (events.ts) E pelo tool `schedule_event` do agente
 * (F7-S04). Centraliza: insert do evento + `event_participants` (organizer = dono
 * do calendar; attendee = contact) e expõe o SEAM `onEventChanged` (notificação/
 * reminder ligados em F7-S05, sem acoplar aqui).
 *
 * Todas as funções recebem um `DbTx` já escopado por RLS (a rota usa req.scoped;
 * o tool usa withWorkspace). Não abrem transação própria — o caller controla o
 * commit, e o seam dispara DEPOIS (best-effort, não derruba a operação).
 */
import { and, eq } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';

const { events, eventParticipants, calendars } = schema;

export type EventRow = typeof events.$inferSelect;

export type EventChangeKind = 'created' | 'cancelled';

export type EventActorType = 'member' | 'agent' | 'system' | 'api';

export interface EventActor {
  readonly type: EventActorType;
  readonly memberId?: string | null;
  readonly agentId?: string | null;
}

export interface EventChangeEvent {
  readonly kind: EventChangeKind;
  readonly workspaceId: string;
  readonly event: EventRow;
  readonly actor: EventActor;
}

/** Hook do seam onEventChanged. Roda DEPOIS do commit lógico da operação. */
export type EventChangeHook = (event: EventChangeEvent) => void | Promise<void>;

const eventChangeHooks: EventChangeHook[] = [];

/**
 * Registra um hook no seam onEventChanged. Idempotente por referência.
 * Chamado no bootstrap por F7-S05 (reminders/notification).
 */
export function onEventChanged(hook: EventChangeHook): void {
  if (!eventChangeHooks.includes(hook)) eventChangeHooks.push(hook);
}

/** Limpa hooks (uso em testes). */
export function __resetEventChangeHooks(): void {
  eventChangeHooks.length = 0;
}

async function emitEventChanged(event: EventChangeEvent): Promise<void> {
  for (const hook of eventChangeHooks) {
    // Side-effects pós-operação não devem derrubar a criação/cancelamento.
    try {
      await hook(event);
    } catch {
      // best-effort
    }
  }
}

export interface CreateEventInput {
  readonly workspaceId: string;
  readonly calendarId: string;
  readonly title: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly type?: EventRow['type'];
  readonly description?: string | null;
  readonly location?: string | null;
  readonly meetingUrl?: string | null;
  readonly contactId?: string | null;
  readonly dealId?: string | null;
  readonly conversationId?: string | null;
  readonly metadata?: Record<string, unknown>;
  /** Members extras a participar (além do organizer = dono do calendar). */
  readonly memberIds?: readonly string[];
}

/** Erro de domínio do event-service. Mapeado a 4xx pelas rotas. */
export class EventServiceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'EventServiceError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Cria um evento + participantes (organizer = dono do calendar; attendee =
 * contact; + memberIds extras). Dispara onEventChanged('created'). NÃO valida
 * disponibilidade — é responsabilidade do caller (a UI/o agente chamam
 * get_available_slots antes; race de conflito é aceitável, §11).
 */
export async function createEvent(
  tx: DbTx,
  input: CreateEventInput,
  actor: EventActor,
): Promise<EventRow> {
  if (input.endAt <= input.startAt) {
    throw new EventServiceError('invalid_range', 'endAt deve ser depois de startAt.', 422);
  }

  // O calendar precisa existir no workspace (sob RLS já está isolado).
  const [calendar] = await tx
    .select({ id: calendars.id, ownerId: calendars.ownerId })
    .from(calendars)
    .where(eq(calendars.id, input.calendarId));
  if (!calendar) {
    throw new EventServiceError('calendar_not_found', 'Calendar inexistente no workspace.', 404);
  }

  const [event] = await tx
    .insert(events)
    .values({
      workspaceId: input.workspaceId,
      calendarId: input.calendarId,
      title: input.title,
      type: input.type ?? 'meeting',
      startAt: input.startAt,
      endAt: input.endAt,
      status: 'scheduled',
      description: input.description ?? null,
      location: input.location ?? null,
      meetingUrl: input.meetingUrl ?? null,
      contactId: input.contactId ?? null,
      dealId: input.dealId ?? null,
      conversationId: input.conversationId ?? null,
      createdBy: actor.type === 'member' ? (actor.memberId ?? null) : null,
      createdByAgentId: actor.type === 'agent' ? (actor.agentId ?? null) : null,
      metadata: input.metadata ?? {},
    })
    .returning();
  if (!event) throw new EventServiceError('insert_failed', 'Falha ao criar evento.', 500);

  // Participantes: organizer (dono do calendar) + extras + contact attendee.
  const organizerIds = new Set<string>();
  if (calendar.ownerId) organizerIds.add(calendar.ownerId);
  const extraMembers = (input.memberIds ?? []).filter((m) => !organizerIds.has(m));

  const participantValues: (typeof eventParticipants.$inferInsert)[] = [];
  for (const memberId of organizerIds) {
    participantValues.push({ eventId: event.id, memberId, role: 'organizer' });
  }
  for (const memberId of extraMembers) {
    participantValues.push({ eventId: event.id, memberId, role: 'attendee' });
  }
  if (input.contactId) {
    participantValues.push({ eventId: event.id, contactId: input.contactId, role: 'attendee' });
  }
  if (participantValues.length > 0) {
    await tx.insert(eventParticipants).values(participantValues);
  }

  await emitEventChanged({ kind: 'created', workspaceId: input.workspaceId, event, actor });
  return event;
}

/**
 * Cancela um evento (status=cancelled). Idempotente: cancelar de novo é no-op
 * que retorna o evento atual. Dispara onEventChanged('cancelled') só na transição.
 */
export async function cancelEvent(
  tx: DbTx,
  eventId: string,
  actor: EventActor,
): Promise<EventRow | null> {
  const [current] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!current) return null;
  if (current.status === 'cancelled') return current;

  const [updated] = await tx
    .update(events)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(events.id, eventId))
    .returning();
  if (!updated) return null;

  await emitEventChanged({
    kind: 'cancelled',
    workspaceId: updated.workspaceId,
    event: updated,
    actor,
  });
  return updated;
}

/** Define o RSVP de um participante (member ou contact) num evento. */
export async function setRsvp(
  tx: DbTx,
  input: {
    eventId: string;
    memberId?: string | null;
    contactId?: string | null;
    rsvp: 'pending' | 'accepted' | 'declined' | 'tentative';
  },
): Promise<typeof eventParticipants.$inferSelect | null> {
  const subject = input.memberId
    ? eq(eventParticipants.memberId, input.memberId)
    : input.contactId
      ? eq(eventParticipants.contactId, input.contactId)
      : null;
  if (!subject) {
    throw new EventServiceError('missing_subject', 'Informe memberId ou contactId.', 400);
  }
  const [updated] = await tx
    .update(eventParticipants)
    .set({ rsvp: input.rsvp })
    .where(and(eq(eventParticipants.eventId, input.eventId), subject))
    .returning();
  return updated ?? null;
}
