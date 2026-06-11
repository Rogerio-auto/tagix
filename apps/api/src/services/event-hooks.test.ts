/**
 * Teste do seam de cancelamento (F7-S05 gap-fill): registerEventHooks → ao
 * cancelar um evento, audita 'event.cancelled' para cada participante. Integração
 * real contra o Postgres dev (RLS).
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import { cancelEvent, createEvent, __resetEventChangeHooks } from './event-service';
import { registerEventHooks } from './event-hooks';

const { workspaces, members, contacts, calendars, auditLogs, plans } = schema;

let ws = '';
let memberId = '';
let contactId = '';
let calendarId = '';

beforeAll(async () => {
  const db = getDb();
  const [free] = await db.select().from(plans).where(eq(plans.key, 'free'));
  const sfx = randomUUID().slice(0, 8);
  const [w] = await db
    .insert(workspaces)
    .values({ name: 'EvtHooks', slug: `evth-${sfx}`, planId: free?.id ?? null })
    .returning();
  if (!w) throw new Error('ws');
  ws = w.id;
  const [m] = await db
    .insert(members)
    .values({
      workspaceId: ws,
      authUserId: randomUUID(),
      email: `evth-${sfx}@t.local`,
      role: 'AGENT',
      status: 'active',
    })
    .returning();
  if (!m) throw new Error('member');
  memberId = m.id;
  const [c] = await db
    .insert(contacts)
    .values({ workspaceId: ws, displayName: 'Lead', phone: `+5511911${sfx.slice(0, 4)}` })
    .returning();
  if (!c) throw new Error('contact');
  contactId = c.id;
  const [cal] = await db
    .insert(calendars)
    .values({ workspaceId: ws, name: 'Cal', type: 'personal', ownerId: memberId, isDefault: true })
    .returning();
  if (!cal) throw new Error('cal');
  calendarId = cal.id;
});

afterAll(async () => {
  __resetEventChangeHooks();
  const db = getDb();
  if (ws) await db.delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

describe('registerEventHooks (cancel → notifica participantes)', () => {
  it('cancelar evento audita event.cancelled por participante', async () => {
    __resetEventChangeHooks();
    registerEventHooks();

    const event = await withWorkspace(ws, (tx) =>
      createEvent(
        tx,
        {
          workspaceId: ws,
          calendarId,
          title: 'Reunião a cancelar',
          startAt: new Date('2099-05-01T13:00:00-03:00'),
          endAt: new Date('2099-05-01T14:00:00-03:00'),
          contactId,
        },
        { type: 'member', memberId },
      ),
    );

    await withWorkspace(ws, (tx) => cancelEvent(tx, event.id, { type: 'member', memberId }));

    const logs = await withWorkspace(ws, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.resourceId, event.id), eq(auditLogs.action, 'event.cancelled'))),
    );
    // organizer (member) + attendee (contact) = 2 participantes.
    expect(logs.length).toBe(2);
  });
});
