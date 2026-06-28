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
import { CalendarNotFoundError, calendarRepo, schema, type DbTx } from '@hm/db';

const { events, eventParticipants } = schema;

export type EventRow = typeof events.$inferSelect;

/** Prioridade do compromisso (F53). Espelha `events_priority_chk`. */
export type EventPriority = 'low' | 'medium' | 'high';

/** Estados do ciclo de vida de um evento (F53). Espelha `events_status_chk`. */
export type EventStatus =
  | 'scheduled'
  | 'confirmed'
  | 'in_progress'
  | 'postponed'
  | 'completed'
  | 'cancelled';

/** Estados terminais: uma vez aqui, o status não muda mais (só via novo evento). */
const TERMINAL_STATUSES: ReadonlySet<EventStatus> = new Set(['completed', 'cancelled']);

/** Resultado de uma transição rejeitada — mapeado a 422 pela rota (mensagem 3 partes). */
export interface StatusTransitionError {
  readonly code: string;
  readonly message: string;
}

/**
 * Máquina de transição de status (F53, server-side). Pura e testável — não toca DB.
 * Regras (UX §2.11, mensagens PT-BR em 3 partes: o quê / porquê / o que fazer):
 *  - Sair de um estado terminal (`completed`/`cancelled`) é proibido.
 *  - Ir para `postponed` exige um `startAt` no futuro (o novo horário do adiamento).
 *  - Repetir o mesmo status é no-op permitido (idempotência).
 * Retorna `null` quando a transição é válida.
 */
export function checkStatusTransition(
  current: EventStatus,
  next: EventStatus,
  ctx: { readonly nextStartAt: Date; readonly now?: Date },
): StatusTransitionError | null {
  if (current === next) return null;

  if (TERMINAL_STATUSES.has(current)) {
    const estado = current === 'cancelled' ? 'cancelado' : 'concluído';
    return {
      code: 'invalid_transition',
      message:
        `Não foi possível alterar o status deste compromisso. ` +
        `Ele já está ${estado}, que é um estado final e não pode ser reaberto. ` +
        `Para retomar o acompanhamento, crie um novo compromisso para o contato.`,
    };
  }

  if (next === 'postponed') {
    const now = ctx.now ?? new Date();
    if (ctx.nextStartAt.getTime() <= now.getTime()) {
      return {
        code: 'invalid_postpone',
        message:
          `Não foi possível adiar o compromisso. ` +
          `Adiar exige uma nova data e hora no futuro, e o horário informado já passou (ou não foi informado). ` +
          `Envie um campo "startAt" com data/hora posterior ao momento atual.`,
      };
    }
  }

  return null;
}

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
  /**
   * Calendar de destino. `null`/ausente → default = o calendário PESSOAL do criador
   * (provisionado on-demand). Só resolve o pessoal quando o ator é um member; agente/
   * system/api SEM calendarId é erro (não têm pessoal).
   */
  readonly calendarId?: string | null;
  readonly title: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly type?: EventRow['type'];
  /** Prioridade do compromisso (F53). Ausente → default 'medium' (igual à coluna). */
  readonly priority?: EventPriority;
  readonly description?: string | null;
  readonly location?: string | null;
  readonly meetingUrl?: string | null;
  readonly contactId?: string | null;
  readonly dealId?: string | null;
  readonly conversationId?: string | null;
  readonly metadata?: Record<string, unknown>;
  /** Members extras a participar (além do organizer = dono do calendar). */
  readonly memberIds?: readonly string[];
  /** Recorrência (RRULE simplificado) — persistida; expansão é na query da API. */
  readonly recurrenceRule?: string | null;
  readonly recurrenceUntil?: Date | null;
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
 *
 * WRAPPER FINO (F53-S08): a persistência vive em `@hm/db` (`calendarRepo.createEvent`),
 * fonte única reusada por API e worker. A API mantém aqui apenas o que é seu:
 *  - validação de range (422);
 *  - resolução do calendar PESSOAL do criador quando `calendarId` é ausente + ator
 *    member (o repo só sabe cair no "Empresa"; o pessoal é conceito da API);
 *  - derivação de `createdBy`/`createdByAgentId` a partir do `actor`;
 *  - mapeamento `CalendarNotFoundError` → `EventServiceError` 404;
 *  - o SEAM `onEventChanged('created')`.
 */
export async function createEvent(
  tx: DbTx,
  input: CreateEventInput,
  actor: EventActor,
): Promise<EventRow> {
  if (input.endAt <= input.startAt) {
    throw new EventServiceError('invalid_range', 'endAt deve ser depois de startAt.', 422);
  }

  // Resolve o calendar de destino. Ausente + ator member → pessoal do criador
  // (provisionado on-demand, idempotente). Ausente + ator não-member → erro.
  let calendarId = input.calendarId ?? null;
  if (!calendarId) {
    if (actor.type === 'member' && actor.memberId) {
      const personal = await calendarRepo.ensurePersonalCalendar(
        tx,
        input.workspaceId,
        actor.memberId,
      );
      calendarId = personal.id;
    } else {
      throw new EventServiceError('calendar_required', 'calendarId é obrigatório.', 400);
    }
  }

  let event: EventRow;
  try {
    event = await calendarRepo.createEvent(tx, {
      workspaceId: input.workspaceId,
      calendarId,
      title: input.title,
      startAt: input.startAt,
      endAt: input.endAt,
      type: input.type,
      priority: input.priority,
      description: input.description,
      location: input.location,
      meetingUrl: input.meetingUrl,
      contactId: input.contactId,
      dealId: input.dealId,
      conversationId: input.conversationId,
      metadata: input.metadata,
      memberIds: input.memberIds,
      recurrenceRule: input.recurrenceRule,
      recurrenceUntil: input.recurrenceUntil,
      createdBy: actor.type === 'member' ? (actor.memberId ?? null) : null,
      createdByAgentId: actor.type === 'agent' ? (actor.agentId ?? null) : null,
    });
  } catch (err) {
    if (err instanceof CalendarNotFoundError) {
      throw new EventServiceError('calendar_not_found', err.message, 404);
    }
    throw err;
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
