import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import {
  __resetEventChangeHooks,
  cancelEvent,
  createEvent,
  onEventChanged,
  setRsvp,
  type EventChangeEvent,
} from './event-service';

const { workspaces, members, contacts, calendars, eventParticipants, plans } = schema;

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
    .values({ name: 'EvtSvc', slug: `evtsvc-${sfx}`, planId: free?.id ?? null })
    .returning();
  if (!w) throw new Error('ws');
  ws = w.id;
  const [m] = await db
    .insert(members)
    .values({
      workspaceId: ws,
      authUserId: randomUUID(),
      email: `evt-${sfx}@t.local`,
      role: 'AGENT',
      status: 'active',
    })
    .returning();
  if (!m) throw new Error('member');
  memberId = m.id;
  const [c] = await db
    .insert(contacts)
    .values({ workspaceId: ws, displayName: 'Lead', phone: `+5511933${sfx.slice(0, 4)}` })
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

describe('event-service.createEvent', () => {
  it('cria evento + organizer (dono) + attendee (contact) e dispara seam created', async () => {
    __resetEventChangeHooks();
    const seen: EventChangeEvent[] = [];
    onEventChanged((e) => {
      seen.push(e);
    });

    const event = await withWorkspace(ws, (tx) =>
      createEvent(
        tx,
        {
          workspaceId: ws,
          calendarId,
          title: 'Demo',
          startAt: new Date('2099-02-01T13:00:00-03:00'),
          endAt: new Date('2099-02-01T14:00:00-03:00'),
          contactId,
        },
        { type: 'member', memberId },
      ),
    );

    expect(event.status).toBe('scheduled');
    expect(event.createdBy).toBe(memberId);

    const parts = await withWorkspace(ws, (tx) =>
      tx.select().from(eventParticipants).where(eq(eventParticipants.eventId, event.id)),
    );
    expect(parts.some((p) => p.memberId === memberId && p.role === 'organizer')).toBe(true);
    expect(parts.some((p) => p.contactId === contactId && p.role === 'attendee')).toBe(true);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe('created');
    expect(seen[0]?.event.id).toBe(event.id);
  });

  it('rejeita range invalido (endAt <= startAt)', async () => {
    await expect(
      withWorkspace(ws, (tx) =>
        createEvent(
          tx,
          {
            workspaceId: ws,
            calendarId,
            title: 'Bad',
            startAt: new Date('2099-02-01T15:00:00-03:00'),
            endAt: new Date('2099-02-01T15:00:00-03:00'),
          },
          { type: 'member', memberId },
        ),
      ),
    ).rejects.toThrow();
  });

  it('ator agente (sem agentId) -> createdBy null e createdByAgentId null', async () => {
    // Separacao member/agent: ator agente nunca preenche createdBy. Um agentId real
    // exigiria seed de um agent (FK); a cobertura E2E agente->evento fica em F7-S04.
    __resetEventChangeHooks();
    const event = await withWorkspace(ws, (tx) =>
      createEvent(
        tx,
        {
          workspaceId: ws,
          calendarId,
          title: 'Via agente',
          startAt: new Date('2099-02-02T13:00:00-03:00'),
          endAt: new Date('2099-02-02T14:00:00-03:00'),
        },
        { type: 'agent', agentId: null },
      ),
    );
    expect(event.createdBy).toBeNull();
    expect(event.createdByAgentId).toBeNull();
  });
});

describe('event-service.cancelEvent + setRsvp', () => {
  it('cancela e dispara seam cancelled; recancelar e no-op sem novo seam', async () => {
    __resetEventChangeHooks();
    const seen: EventChangeEvent[] = [];
    onEventChanged((e) => {
      if (e.kind === 'cancelled') seen.push(e);
    });

    const event = await withWorkspace(ws, (tx) =>
      createEvent(
        tx,
        {
          workspaceId: ws,
          calendarId,
          title: 'Pra cancelar',
          startAt: new Date('2099-03-01T13:00:00-03:00'),
          endAt: new Date('2099-03-01T14:00:00-03:00'),
        },
        { type: 'member', memberId },
      ),
    );

    const c1 = await withWorkspace(ws, (tx) =>
      cancelEvent(tx, event.id, { type: 'member', memberId }),
    );
    expect(c1?.status).toBe('cancelled');
    expect(seen).toHaveLength(1);

    const c2 = await withWorkspace(ws, (tx) =>
      cancelEvent(tx, event.id, { type: 'member', memberId }),
    );
    expect(c2?.status).toBe('cancelled');
    expect(seen).toHaveLength(1); // no-op: nenhum seam adicional
  });

  it('setRsvp atualiza o rsvp do participante member', async () => {
    __resetEventChangeHooks();
    const event = await withWorkspace(ws, (tx) =>
      createEvent(
        tx,
        {
          workspaceId: ws,
          calendarId,
          title: 'RSVP',
          startAt: new Date('2099-04-01T13:00:00-03:00'),
          endAt: new Date('2099-04-01T14:00:00-03:00'),
        },
        { type: 'member', memberId },
      ),
    );
    const updated = await withWorkspace(ws, (tx) =>
      setRsvp(tx, { eventId: event.id, memberId, rsvp: 'accepted' }),
    );
    expect(updated?.rsvp).toBe('accepted');
  });
});
