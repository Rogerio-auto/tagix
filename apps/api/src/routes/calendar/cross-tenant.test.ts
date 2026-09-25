/**
 * F70-S11 — calendário recusa referência de outro workspace.
 *  - `POST /api/events`: contato, deal, conversa e membros (trava no `event-service`,
 *    compartilhada com a API v1 e o tool do agente);
 *  - `POST/PUT /api/calendars`: dono e time.
 * Resposta idêntica à de um id inexistente; nada gravado.
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, schema } from '@hm/db';

vi.mock('../../middlewares/auth', async () =>
  (await import('../deals/__tests__/two-workspaces')).authMiddlewareMock(),
);

const { actAs, dropTenants, ghostId, seedTenant } =
  await import('../deals/__tests__/two-workspaces');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { createEventsRouter } = await import('./events');
const { createCalendarsRouter } = await import('./calendars');

const app = express();
app.use(express.json());
app.use(createEventsRouter());
app.use(createCalendarsRouter());

let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  A = await seedTenant('A');
  B = await seedTenant('B');
});

afterAll(async () => {
  await dropTenants(A, B);
  await closeDb();
});

beforeEach(() => actAs(A));

const START = '2026-10-01T13:00:00.000Z';
const END = '2026-10-01T14:00:00.000Z';

async function eventsOf(workspaceId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(eq(schema.events.workspaceId, workspaceId));
  return rows.length;
}

describe('POST /api/events (F70-S11)', () => {
  const cases: ReadonlyArray<{ field: string; body: (id: string) => Record<string, unknown> }> = [
    { field: 'contactId', body: (id) => ({ contactId: id }) },
    { field: 'dealId', body: (id) => ({ dealId: id }) },
    { field: 'conversationId', body: (id) => ({ conversationId: id }) },
    { field: 'memberIds', body: (id) => ({ memberIds: [A.otherMember, id] }) },
  ];
  const foreignOf: Record<string, () => string> = {
    contactId: () => B.contact,
    dealId: () => B.deal,
    conversationId: () => B.conversation,
    memberIds: () => B.member,
  };

  for (const c of cases) {
    it(`${c.field} de B → 422, igual a inexistente, sem gravar`, async () => {
      const base = { calendarId: A.calendar, title: 'Reunião', startAt: START, endAt: END };
      const foreign = foreignOf[c.field];
      if (!foreign) throw new Error('caso sem id estrangeiro');
      const res = await request(app)
        .post('/api/events')
        .send({ ...base, ...c.body(foreign()) });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('invalid_reference');
      expect(res.body.fields).toEqual([c.field]);

      const ghost = await request(app)
        .post('/api/events')
        .send({ ...base, ...c.body(ghostId()) });
      expect(ghost.status).toBe(422);
      expect(ghost.body).toEqual(res.body);

      expect(await eventsOf(A.ws)).toBe(0);
    });
  }

  it('caminho feliz com contato, deal, conversa e membro próprios → 201', async () => {
    const res = await request(app)
      .post('/api/events')
      .send({
        calendarId: A.calendar,
        title: 'Reunião',
        startAt: START,
        endAt: END,
        contactId: A.contact,
        dealId: A.deal,
        conversationId: A.conversation,
        memberIds: [A.otherMember],
      });
    expect(res.status).toBe(201);
    expect(res.body.event.workspaceId).toBe(A.ws);
  });
});

describe('POST/PUT /api/calendars (F70-S11)', () => {
  it('ownerId/teamId de B no POST → 422, igual a inexistente, sem gravar', async () => {
    const before = await getDb()
      .select({ id: schema.calendars.id })
      .from(schema.calendars)
      .where(eq(schema.calendars.workspaceId, A.ws));
    const res = await request(app)
      .post('/api/calendars')
      .send({ name: 'Equipe', type: 'team', ownerId: B.member, teamId: B.team });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual(['ownerId', 'teamId']);
    const ghost = await request(app)
      .post('/api/calendars')
      .send({ name: 'Equipe', type: 'team', ownerId: ghostId(), teamId: ghostId() });
    expect(ghost.body).toEqual(res.body);
    const after = await getDb()
      .select({ id: schema.calendars.id })
      .from(schema.calendars)
      .where(eq(schema.calendars.workspaceId, A.ws));
    expect(after.length).toBe(before.length);
  });

  it('ownerId de B no PUT → 422 e o calendário não muda', async () => {
    const res = await request(app).put(`/api/calendars/${A.calendar}`).send({ ownerId: B.member });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual(['ownerId']);
    const [row] = await getDb()
      .select({ ownerId: schema.calendars.ownerId })
      .from(schema.calendars)
      .where(eq(schema.calendars.id, A.calendar));
    expect(row?.ownerId).toBe(A.member);
  });

  it('caminho feliz: dono e time próprios → 201/200', async () => {
    const created = await request(app)
      .post('/api/calendars')
      .send({ name: 'Equipe', type: 'team', ownerId: A.otherMember, teamId: A.team });
    expect(created.status).toBe(201);
    const updated = await request(app)
      .put(`/api/calendars/${A.calendar}`)
      .send({ ownerId: A.otherMember, teamId: A.team });
    expect(updated.status).toBe(200);
    expect(updated.body.calendar.ownerId).toBe(A.otherMember);
  });
});
