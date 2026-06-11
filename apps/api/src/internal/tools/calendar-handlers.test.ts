/**
 * Testes de integração dos handlers Node das calendar tools (F7-S04) contra o
 * Postgres dev (RLS real). Cobre get_available_slots (slots reais via
 * compute_available_slots), schedule_event (cria evento reusando createEvent) e
 * list_calendars (lista sob RLS). O caminho agente→OpenRouter→tool exige runtime
 * real; aqui validamos o handler com o `tx` RLS-escopado de verdade.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import {
  getAvailableSlots,
  listCalendars,
  scheduleEvent,
} from './calendar-handlers';
import type { ToolCallEnvelope } from './registry';

const { workspaces, members, contacts, calendars, availabilityRules, events, agents, plans } =
  schema;

let ws = '';
let memberId = '';
let contactId = '';
let calendarId = '';
let agentId = '';

function env(args: Record<string, unknown>): ToolCallEnvelope {
  return {
    workspaceId: ws,
    conversationId: null,
    agentId,
    executionId: randomUUID(),
    args,
  };
}

beforeAll(async () => {
  const db = getDb();
  const [free] = await db.select().from(plans).where(eq(plans.key, 'free'));
  const sfx = randomUUID().slice(0, 8);
  const [w] = await db
    .insert(workspaces)
    .values({ name: 'CalHandlers', slug: `calh-${sfx}`, planId: free?.id ?? null })
    .returning();
  if (!w) throw new Error('ws');
  ws = w.id;
  const [m] = await db
    .insert(members)
    .values({
      workspaceId: ws,
      authUserId: randomUUID(),
      email: `calh-${sfx}@t.local`,
      role: 'AGENT',
      status: 'active',
    })
    .returning();
  if (!m) throw new Error('member');
  memberId = m.id;
  const [c] = await db
    .insert(contacts)
    .values({ workspaceId: ws, displayName: 'Lead', phone: `+5511922${sfx.slice(0, 4)}` })
    .returning();
  if (!c) throw new Error('contact');
  contactId = c.id;
  const [cal] = await db
    .insert(calendars)
    .values({ workspaceId: ws, name: 'Default', type: 'personal', ownerId: memberId, isDefault: true })
    .returning();
  if (!cal) throw new Error('cal');
  calendarId = cal.id;
  const [ag] = await db
    .insert(agents)
    .values({ workspaceId: ws, name: 'Agente Cal', systemPrompt: 'Você agenda reuniões.' })
    .returning();
  if (!ag) throw new Error('agent');
  agentId = ag.id;
  // Regra: segunda-feira 08–18.
  await db.insert(availabilityRules).values({
    workspaceId: ws,
    memberId,
    name: 'Comercial',
    dayOfWeek: 1,
    startTime: '08:00',
    endTime: '18:00',
  });
});

afterAll(async () => {
  const db = getDb();
  if (ws) await db.delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

describe('calendar-handlers (integração)', () => {
  it('list_calendars lista o calendar default sob RLS', async () => {
    const res = await withWorkspace(ws, (tx) => listCalendars(env({}), tx));
    expect(res.ok).toBe(true);
    const payload = res.payload as { calendars: Array<{ id: string; is_default: boolean }> };
    expect(payload.calendars.some((c) => c.id === calendarId && c.is_default)).toBe(true);
  });

  it('get_available_slots retorna slots reais (resolve member do calendar default)', async () => {
    // 2099-01-05 é segunda (DOW=1). Sem member_id → resolve via calendar default.
    const res = await withWorkspace(ws, (tx) =>
      getAvailableSlots(env({ date: '2099-01-05', interval_minutes: 60 }), tx),
    );
    expect(res.ok).toBe(true);
    const payload = res.payload as { slots: Array<{ start_at: string }> };
    expect(payload.slots.length).toBeGreaterThan(0);
  });

  it('schedule_event cria evento reusando createEvent (calendar default + contato)', async () => {
    const res = await withWorkspace(ws, (tx) =>
      scheduleEvent(
        env({
          title: 'Reunião agente',
          start_at: '2099-01-05T10:00:00-03:00',
          end_at: '2099-01-05T11:00:00-03:00',
          contact_id: contactId,
        }),
        tx,
      ),
    );
    expect(res.ok).toBe(true);
    const payload = res.payload as { event_id: string };
    expect(payload.event_id).toBeTruthy();

    const rows = await withWorkspace(ws, (tx) =>
      tx.select().from(events).where(eq(events.id, payload.event_id)),
    );
    expect(rows[0]?.title).toBe('Reunião agente');
    expect(rows[0]?.createdByAgentId).toBeTruthy();
    expect(rows[0]?.contactId).toBe(contactId);
  });

  it('schedule_event sem calendar disponível falha com mensagem estável', async () => {
    // Workspace efêmero sem calendar default.
    const db = getDb();
    const [free] = await db.select().from(plans).where(eq(plans.key, 'free'));
    const [w2] = await db
      .insert(workspaces)
      .values({ name: 'NoCal', slug: `nocal-${randomUUID().slice(0, 8)}`, planId: free?.id ?? null })
      .returning();
    if (!w2) throw new Error('w2');
    try {
      const res = await withWorkspace(w2.id, (tx) =>
        scheduleEvent(
          {
            workspaceId: w2.id,
            conversationId: null,
            agentId: agentId,
            executionId: randomUUID(),
            args: {
              title: 'Reunião sem calendário',
              start_at: '2099-01-05T10:00:00-03:00',
              end_at: '2099-01-05T11:00:00-03:00',
            },
          },
          tx,
        ),
      );
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/calendário/i);
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, w2.id));
    }
  });
});
