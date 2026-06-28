/**
 * F54-S01 — tempo real de compromissos (event:*) + resumo do contato na listagem.
 *
 * Exercita o caminho REAL das rotas (event-service e event-realtime NÃO são mockados):
 *  1. Mutações disparam emit best-effort — POST→created, PUT→updated, cancel→updated.
 *     O publisher é injetado via `setEventRealtimePublisher` para capturar sem broker.
 *  2. GET /api/events e /:id enriquecem cada evento com `contact` resumido (ou null).
 *
 * Só `@hm/db` (tx in-memory, agora com `contacts`) e `auth` são substituídos.
 */
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DrizzleOrm from 'drizzle-orm';
import type { EventChangedPayload, ServerToClientEvent } from '@hm/shared';

// ─── IDs fixos ────────────────────────────────────────────────────────────────
const WS = '00000000-0000-0000-0000-0000000000ff';
const CAL = '00000000-0000-0000-0000-0000000000a1';
const MEMBER = '00000000-0000-0000-0000-0000000000b1';
const EVT = '00000000-0000-0000-0000-0000000000e1';
const CONTACT = '00000000-0000-0000-0000-0000000000d1';

type Row = Record<string, unknown>;

let calendarsStore: Row[] = [];
let eventsStore: Row[] = [];
let contactsStore: Row[] = [];

function seedEvent(partial: Row): void {
  eventsStore = [
    {
      id: EVT,
      workspaceId: WS,
      calendarId: CAL,
      title: 'evt',
      type: 'meeting',
      status: 'scheduled',
      priority: 'medium',
      startAt: new Date('2026-02-10T10:00:00Z'),
      endAt: new Date('2026-02-10T11:00:00Z'),
      description: null,
      location: null,
      meetingUrl: null,
      contactId: null,
      dealId: null,
      conversationId: null,
      createdBy: MEMBER,
      createdByAgentId: null,
      recurrenceRule: null,
      recurrenceUntil: null,
      recurrenceParentId: null,
      metadata: {},
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: null,
      ...partial,
    },
  ];
}

// ─── tx in-memory ────────────────────────────────────────────────────────────────
interface SelectChain {
  where: () => SelectChain;
  orderBy: () => SelectChain;
  limit: () => SelectChain;
  then: <T>(resolve: (rows: Row[]) => T) => Promise<T>;
}

function thenable(getRows: () => Row[]): SelectChain {
  const chain: SelectChain = {
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve) => Promise.resolve(getRows()).then(resolve),
  };
  return chain;
}

function storeFor(name: string | undefined): Row[] {
  if (name === 'events') return eventsStore;
  if (name === 'contacts') return contactsStore;
  if (name === 'eventParticipants') return [];
  return calendarsStore;
}

function makeTx() {
  return {
    select: (_cols?: unknown) => ({
      from: (t: { __name?: string }) => thenable(() => storeFor(t.__name)),
    }),
    insert: (t: { __name?: string }) => ({
      values: (vals: Row | Row[]) => {
        if (t.__name === 'events') {
          const v = vals as Row;
          const row: Row = {
            id: 'evt-new-1',
            recurrenceParentId: null,
            createdAt: new Date(),
            updatedAt: null,
            ...v,
          };
          eventsStore.push(row);
          return { returning: async (): Promise<Row[]> => [row] };
        }
        return { returning: async (): Promise<Row[]> => [] };
      },
    }),
    update: (_t: { __name?: string }) => ({
      set: (patch: Row) => ({
        where: () => ({
          returning: async (): Promise<Row[]> => {
            const current = eventsStore[0] ?? {};
            const updated: Row = { ...current, ...patch };
            eventsStore[0] = updated;
            return [updated];
          },
        }),
      }),
    }),
  };
}

type TestTx = ReturnType<typeof makeTx>;

// ─── Mock de @hm/db (agora com `contacts`) ───────────────────────────────────────
vi.mock('@hm/db', () => {
  const calendars = { __name: 'calendars', id: 'id', ownerId: 'ownerId', isDefault: 'isDefault' };
  const events = { __name: 'events', id: 'id', contactId: 'contactId', calendarId: 'calendarId' };
  const eventParticipants = { __name: 'eventParticipants', eventId: 'eventId' };
  const contacts = {
    __name: 'contacts',
    id: 'id',
    displayName: 'displayName',
    avatarUrl: 'avatarUrl',
    phone: 'phone',
  };

  class CalendarNotFoundError extends Error {
    constructor(message = 'Calendar inexistente no workspace.') {
      super(message);
      this.name = 'CalendarNotFoundError';
    }
  }

  const createEvent = async (tx: TestTx, input: Row): Promise<Row> => {
    const calendarId = (input['calendarId'] as string | null | undefined) ?? calendarsStore[0]?.['id'];
    const calendar = calendarsStore.find((c) => c['id'] === calendarId);
    if (!calendar) throw new CalendarNotFoundError();
    const [event] = await tx
      .insert(events)
      .values({
        workspaceId: input['workspaceId'],
        calendarId: calendar['id'],
        title: input['title'],
        type: input['type'] ?? 'meeting',
        startAt: input['startAt'],
        endAt: input['endAt'],
        status: 'scheduled',
        priority: input['priority'] ?? 'medium',
        contactId: input['contactId'] ?? null,
        dealId: input['dealId'] ?? null,
        conversationId: input['conversationId'] ?? null,
        createdBy: input['createdBy'] ?? null,
        metadata: input['metadata'] ?? {},
      })
      .returning();
    if (!event) throw new Error('Falha ao criar evento.');
    return event;
  };

  return {
    schema: { calendars, events, eventParticipants, contacts },
    CalendarNotFoundError,
    calendarRepo: {
      ensurePersonalCalendar: async () => calendarsStore[0],
      ensureWorkspaceCalendar: async () => calendarsStore[0],
      accessibleCalendarIds: async () => [CAL],
      createEvent,
    },
  };
});

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof DrizzleOrm>();
  return {
    ...actual,
    eq: () => ({}),
    and: () => ({}),
    or: () => ({}),
    gte: () => ({}),
    lte: () => ({}),
    inArray: () => ({}),
    isNotNull: () => ({}),
    asc: () => ({}),
    desc: () => ({}),
  };
});

vi.mock('../../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers['x-test-auth'] !== '1') {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    (req as { auth?: unknown }).auth = {
      workspace: { id: WS, timezone: 'America/Sao_Paulo' },
      member: { role: 'ADMIN', id: MEMBER },
    };
    next();
  },
  withRLS: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as { scoped?: unknown }).scoped = (fn: (tx: TestTx) => Promise<unknown>) => fn(makeTx());
    next();
  },
  requireRole:
    (_perm: string) =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
}));

// ─── Módulos reais sob teste ─────────────────────────────────────────────────────
const { createEventsRouter } = await import('../events');
const { setEventRealtimePublisher } = await import('../../../services/event-realtime');

interface Captured {
  event: ServerToClientEvent;
  workspaceId: string;
  data: EventChangedPayload;
}
let emitted: Captured[] = [];

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(createEventsRouter());
  return app;
}

beforeEach(() => {
  calendarsStore = [{ id: CAL, workspaceId: WS, ownerId: MEMBER, isDefault: true }];
  eventsStore = [];
  contactsStore = [];
  emitted = [];
  setEventRealtimePublisher({
    publish: async (event, workspaceId, data) => {
      emitted.push({ event, workspaceId, data: data as EventChangedPayload });
    },
  });
});

afterEach(() => {
  setEventRealtimePublisher(null);
});

// ─── emit nas mutações ────────────────────────────────────────────────────────────
describe('emit best-effort nas mutações', () => {
  it('POST → event:created (kind=created, contactId no payload)', async () => {
    const res = await request(makeApp())
      .post('/api/events')
      .set('x-test-auth', '1')
      .send({
        calendarId: CAL,
        title: 'Ligar para o cliente',
        startAt: '2026-02-10T09:00:00Z',
        endAt: '2026-02-10T09:15:00Z',
        contactId: CONTACT,
      });
    expect(res.status).toBe(201);
    expect(emitted).toHaveLength(1);
    const [first] = emitted;
    expect(first?.event).toBe('event:created');
    expect(first?.workspaceId).toBe(WS);
    expect(first?.data.kind).toBe('created');
    expect(first?.data.contactId).toBe(CONTACT);
  });

  it('PUT (transição de status) → event:updated (kind=updated)', async () => {
    seedEvent({ status: 'scheduled', contactId: CONTACT });
    const res = await request(makeApp())
      .put(`/api/events/${EVT}`)
      .set('x-test-auth', '1')
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.event).toBe('event:updated');
    expect(emitted[0]?.data.kind).toBe('updated');
    expect(emitted[0]?.data.eventId).toBe(EVT);
  });

  it('cancel → event:updated (status cancelled continua um update)', async () => {
    seedEvent({ status: 'scheduled' });
    const res = await request(makeApp())
      .post(`/api/events/${EVT}/cancel`)
      .set('x-test-auth', '1')
      .send({});
    expect(res.status).toBe(200);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.event).toBe('event:updated');
    expect(emitted[0]?.data.kind).toBe('updated');
  });

  it('PUT inválido (transição de terminal) NÃO emite', async () => {
    seedEvent({ status: 'completed' });
    const res = await request(makeApp())
      .put(`/api/events/${EVT}`)
      .set('x-test-auth', '1')
      .send({ status: 'scheduled' });
    expect(res.status).toBe(422);
    expect(emitted).toHaveLength(0);
  });
});

// ─── enriquecimento com `contact` ──────────────────────────────────────────────────
describe('GET /api/events* — contact resumido', () => {
  it('listagem inclui contact { id, name, avatarUrl, phone } quando vinculado', async () => {
    contactsStore = [
      {
        id: CONTACT,
        displayName: 'Maria Silva',
        avatarUrl: 'https://cdn/x.png',
        phone: '+5511999999999',
      },
    ];
    seedEvent({ contactId: CONTACT });
    const res = await request(makeApp()).get('/api/events').set('x-test-auth', '1');
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].contact).toEqual({
      id: CONTACT,
      name: 'Maria Silva',
      avatarUrl: 'https://cdn/x.png',
      phone: '+5511999999999',
    });
  });

  it('listagem traz contact=null quando o evento não tem contato', async () => {
    seedEvent({ contactId: null });
    const res = await request(makeApp()).get('/api/events').set('x-test-auth', '1');
    expect(res.status).toBe(200);
    expect(res.body.events[0].contact).toBeNull();
  });

  it('detalhe inclui contact resumido (avatar/phone null preservados)', async () => {
    contactsStore = [{ id: CONTACT, displayName: 'João', avatarUrl: null, phone: null }];
    seedEvent({ contactId: CONTACT });
    const res = await request(makeApp()).get(`/api/events/${EVT}`).set('x-test-auth', '1');
    expect(res.status).toBe(200);
    expect(res.body.contact).toEqual({
      id: CONTACT,
      name: 'João',
      avatarUrl: null,
      phone: null,
    });
    // Contrato existente preservado (aditivo).
    expect(res.body.event.id).toBe(EVT);
    expect(Array.isArray(res.body.participants)).toBe(true);
  });

  it('detalhe traz contact=null sem vínculo', async () => {
    seedEvent({ contactId: null });
    const res = await request(makeApp()).get(`/api/events/${EVT}`).set('x-test-auth', '1');
    expect(res.status).toBe(200);
    expect(res.body.contact).toBeNull();
  });
});
