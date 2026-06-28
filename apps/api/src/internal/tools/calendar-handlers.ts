/**
 * Handlers Node das calendar tools (F7-S04) — registrados no endpoint interno
 * `POST /internal/tools/:toolKey` (F2-S07). Cada handler roda DENTRO de
 * `withWorkspace(workspaceId, tx)` (RLS já escopada) e devolve `ToolHandlerResult`.
 *
 * Arquivo NOVO (não toca workflow-handlers.ts). Padrão callback F5: o Python só
 * declara o contrato; a regra de negócio é single source of truth aqui:
 *  - list_calendars      → lista calendars sob RLS.
 *  - get_available_slots → chama `compute_available_slots` (F7-S01).
 *  - schedule_event      → reusa `createEvent` (F7-S03), ponto ÚNICO de criação;
 *                          resolve calendar default + contato da conversa.
 *
 * Playground: o `CallbackTool` (Python) curto-circuita antes do callback — estes
 * handlers nunca rodam em simulação, então não criam efeito colateral.
 *
 * Registro na registry interna = gap-fill do orchestrator (registerCalendarHandlers).
 */
import { z } from 'zod';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@hm/db';
import type { ToolHandler, ToolHandlerRegistry, ToolHandlerResult } from './registry';
import { EventServiceError, createEvent } from '../../services/event-service';

const { calendars, conversations } = schema;

function fail(error: string): ToolHandlerResult {
  return { ok: false, error };
}

// ─── list_calendars ──────────────────────────────────────────────────────────
const listCalendarsArgs = z.object({
  owner_member_id: z.string().uuid().nullish(),
  type: z.enum(['personal', 'team', 'workspace']).nullish(),
});

const listCalendars: ToolHandler = async (env, tx) => {
  const parsed = listCalendarsArgs.safeParse(env.args);
  if (!parsed.success) return fail('Argumentos inválidos para list_calendars.');
  const conds = [];
  if (parsed.data.owner_member_id) conds.push(eq(calendars.ownerId, parsed.data.owner_member_id));
  if (parsed.data.type) conds.push(eq(calendars.type, parsed.data.type));
  const rows = await tx
    .select({
      id: calendars.id,
      name: calendars.name,
      type: calendars.type,
      isDefault: calendars.isDefault,
    })
    .from(calendars)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(calendars.isDefault), asc(calendars.name))
    .limit(20);
  return {
    ok: true,
    content:
      rows.length === 0
        ? 'Nenhum calendário encontrado.'
        : `Calendários: ${rows.map((c) => `${c.name} (${c.type})`).join(', ')}.`,
    action: 'list_calendars',
    tableName: 'calendars',
    payload: {
      calendars: rows.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        is_default: c.isDefault,
      })),
    },
  };
};

// ─── get_available_slots ─────────────────────────────────────────────────────
const getSlotsArgs = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  member_id: z.string().uuid().nullish(),
  calendar_id: z.string().uuid().nullish(),
  interval_minutes: z.number().int().min(15).max(240).default(60),
  min_notice_minutes: z.number().int().min(0).default(30),
  buffer_minutes: z.number().int().min(0).max(240).default(15),
  max_slots: z.number().int().min(1).max(50).default(10),
});

type SlotRow = {
  start_at: string;
  end_at: string;
  duration_minutes: number;
} & Record<string, unknown>;

const getAvailableSlots: ToolHandler = async (env, tx) => {
  const parsed = getSlotsArgs.safeParse(env.args);
  if (!parsed.success) return fail('Argumentos inválidos para get_available_slots.');
  const a = parsed.data;

  // Resolve o member: arg > dono do calendar_id > dono do calendar default.
  let memberId = a.member_id ?? null;
  if (!memberId && a.calendar_id) {
    const [cal] = await tx
      .select({ ownerId: calendars.ownerId })
      .from(calendars)
      .where(eq(calendars.id, a.calendar_id));
    memberId = cal?.ownerId ?? null;
  }
  if (!memberId) {
    const [def] = await tx
      .select({ ownerId: calendars.ownerId })
      .from(calendars)
      .where(eq(calendars.isDefault, true))
      .limit(1);
    memberId = def?.ownerId ?? null;
  }
  if (!memberId) return fail('Nenhum calendário com responsável encontrado para calcular horários.');

  const result = await tx.execute<SlotRow>(sql`
    SELECT start_at, end_at, duration_minutes
    FROM compute_available_slots(
      ${env.workspaceId}::uuid,
      ${memberId}::uuid,
      ${a.date}::date,
      ${a.interval_minutes}::integer,
      ${a.min_notice_minutes}::integer,
      ${a.buffer_minutes}::integer,
      ${a.max_slots}::integer
    )
  `);
  const slots = (Array.from(result) as SlotRow[]).map((r) => ({
    start_at: r.start_at,
    end_at: r.end_at,
    duration_minutes: r.duration_minutes,
  }));
  return {
    ok: true,
    content:
      slots.length === 0
        ? `Nenhum horário disponível em ${a.date}.`
        : `${slots.length} horário(s) disponível(is) em ${a.date}.`,
    action: 'get_available_slots',
    payload: { slots },
  };
};

// ─── schedule_event ──────────────────────────────────────────────────────────
const scheduleEventArgs = z.object({
  title: z.string().min(2).max(300),
  start_at: z.string().datetime({ offset: true }),
  end_at: z.string().datetime({ offset: true }),
  calendar_id: z.string().uuid().nullish(),
  type: z
    .enum([
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
    ])
    .nullish(),
  priority: z.enum(['low', 'medium', 'high']).nullish(),
  description: z.string().max(5000).nullish(),
  location: z.string().max(500).nullish(),
  meeting_url: z.string().url().max(1000).nullish(),
  contact_id: z.string().uuid().nullish(),
});

const scheduleEvent: ToolHandler = async (env, tx) => {
  const parsed = scheduleEventArgs.safeParse(env.args);
  if (!parsed.success) return fail('Argumentos inválidos para schedule_event.');
  const a = parsed.data;

  // Resolve o calendar: arg > calendar default do workspace.
  let calendarId = a.calendar_id ?? null;
  if (!calendarId) {
    const [def] = await tx
      .select({ id: calendars.id })
      .from(calendars)
      .where(eq(calendars.isDefault, true))
      .limit(1);
    calendarId = def?.id ?? null;
  }
  if (!calendarId) return fail('Nenhum calendário disponível para agendar.');

  // Resolve o contato: arg > contato da conversa do contexto.
  let contactId = a.contact_id ?? null;
  if (!contactId && env.conversationId) {
    const [conv] = await tx
      .select({ contactId: conversations.contactId })
      .from(conversations)
      .where(eq(conversations.id, env.conversationId))
      .limit(1);
    contactId = conv?.contactId ?? null;
  }

  try {
    const event = await createEvent(
      tx,
      {
        workspaceId: env.workspaceId,
        calendarId,
        title: a.title,
        startAt: new Date(a.start_at),
        endAt: new Date(a.end_at),
        type: a.type ?? 'meeting',
        priority: a.priority ?? undefined,
        description: a.description ?? null,
        location: a.location ?? null,
        meetingUrl: a.meeting_url ?? null,
        contactId,
        conversationId: env.conversationId,
      },
      { type: 'agent', agentId: env.agentId },
    );
    return {
      ok: true,
      content: `Evento '${event.title}' agendado.`,
      action: 'schedule_event',
      tableName: 'events',
      payload: {
        event_id: event.id,
        title: event.title,
        start_at: event.startAt,
        end_at: event.endAt,
      },
    };
  } catch (err: unknown) {
    if (err instanceof EventServiceError) return fail(err.message);
    throw err;
  }
};

/** Registra os handlers de calendar no registry interno (gap-fill do orchestrator). */
export function registerCalendarHandlers(registry: ToolHandlerRegistry): ToolHandlerRegistry {
  return registry
    .register('list_calendars', listCalendars)
    .register('get_available_slots', getAvailableSlots)
    .register('schedule_event', scheduleEvent);
}

export { listCalendars, getAvailableSlots, scheduleEvent };
