/**
 * F53-S02 — validação de priority/novos type/dueAction + máquina de transição de status.
 *
 * Dois blocos:
 *  1. Unidade PURA de `checkStatusTransition` (event-service): estados terminais,
 *     postergação que exige horário futuro, no-op do mesmo status.
 *  2. Integração de rotas (POST/PUT /api/events) exercitando o caminho REAL — o
 *     `event-service` NÃO é mockado, então `createEvent` e `checkStatusTransition`
 *     rodam de verdade. Só `@hm/db` (tx in-memory) e `auth` são substituídos.
 *
 * Foco: aceitar os campos novos da F53 (priority, type comerciais, metadata.dueAction)
 * e governar as transições inválidas → 422 PT-BR (3 partes).
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DrizzleOrm from 'drizzle-orm';

// ─── IDs fixos ────────────────────────────────────────────────────────────────
const WS = '00000000-0000-0000-0000-0000000000ff';
const CAL = '00000000-0000-0000-0000-0000000000a1';
const MEMBER = '00000000-0000-0000-0000-0000000000b1';
const EVT = '00000000-0000-0000-0000-0000000000e1';

type Row = Record<string, unknown>;

// Stores in-memory manipulados por teste.
let calendarsStore: Row[] = [];
let eventsStore: Row[] = [];

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

// ─── tx in-memory ───────────────────────────────────────────────────────────────
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

function makeTx() {
  return {
    select: (_cols?: unknown) => ({
      from: (t: { __name?: string }) =>
        thenable(() => (t.__name === 'events' ? eventsStore : calendarsStore)),
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
        // event_participants: inserido sem .returning(); só não pode lançar.
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

// ─── Mock de @hm/db ────────────────────────────────────────────────────────────
vi.mock('@hm/db', () => {
  const calendars = { __name: 'calendars', id: 'id', ownerId: 'ownerId', isDefault: 'isDefault' };
  const events = { __name: 'events', id: 'id' };
  const eventParticipants = { __name: 'eventParticipants' };
  return {
    schema: { calendars, events, eventParticipants },
    calendarRepo: {
      ensurePersonalCalendar: async () => calendarsStore[0],
      ensureWorkspaceCalendar: async () => calendarsStore[0],
      accessibleCalendarIds: async () => [CAL],
    },
  };
});

// drizzle-orm: operadores viram no-op (a tx in-memory ignora os predicados).
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

// ─── Mock de auth (sessão ADMIN → ownership fino sempre passa) ──────────────────
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
const { checkStatusTransition } = await import('../../../services/event-service');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(createEventsRouter());
  return app;
}

beforeEach(() => {
  calendarsStore = [{ id: CAL, workspaceId: WS, ownerId: MEMBER, isDefault: true }];
  eventsStore = [];
});

// ─── 1. checkStatusTransition (puro) ─────────────────────────────────────────────
describe('checkStatusTransition (máquina de status pura)', () => {
  const future = new Date(Date.now() + 86_400_000);
  const past = new Date('2020-01-01T00:00:00Z');

  it('mesmo status é no-op permitido', () => {
    expect(checkStatusTransition('scheduled', 'scheduled', { nextStartAt: past })).toBeNull();
  });

  it('transição comum válida (scheduled → completed)', () => {
    expect(checkStatusTransition('scheduled', 'completed', { nextStartAt: past })).toBeNull();
  });

  it('scheduled → in_progress válida', () => {
    expect(checkStatusTransition('scheduled', 'in_progress', { nextStartAt: past })).toBeNull();
  });

  it('sair de cancelled (terminal) é rejeitado', () => {
    const err = checkStatusTransition('cancelled', 'scheduled', { nextStartAt: future });
    expect(err?.code).toBe('invalid_transition');
    expect(err?.message).toMatch(/cancelado/);
  });

  it('sair de completed (terminal) é rejeitado', () => {
    const err = checkStatusTransition('completed', 'in_progress', { nextStartAt: future });
    expect(err?.code).toBe('invalid_transition');
    expect(err?.message).toMatch(/concluído/);
  });

  it('postponed exige startAt futuro — passado → invalid_postpone', () => {
    const err = checkStatusTransition('scheduled', 'postponed', { nextStartAt: past });
    expect(err?.code).toBe('invalid_postpone');
    expect(err?.message).toMatch(/futuro/);
  });

  it('postponed com startAt futuro → válida', () => {
    expect(checkStatusTransition('confirmed', 'postponed', { nextStartAt: future })).toBeNull();
  });
});

// ─── 2. POST /api/events — campos novos ──────────────────────────────────────────
describe('POST /api/events — priority + type comerciais + dueAction', () => {
  it('cria com priority=high e type=whatsapp (persistidos)', async () => {
    const res = await request(makeApp())
      .post('/api/events')
      .set('x-test-auth', '1')
      .send({
        calendarId: CAL,
        title: 'Retornar no WhatsApp',
        startAt: '2026-02-10T09:00:00Z',
        endAt: '2026-02-10T09:15:00Z',
        type: 'whatsapp',
        priority: 'high',
      });
    expect(res.status).toBe(201);
    expect(res.body.event.type).toBe('whatsapp');
    expect(res.body.event.priority).toBe('high');
  });

  it('priority default = medium quando ausente', async () => {
    const res = await request(makeApp())
      .post('/api/events')
      .set('x-test-auth', '1')
      .send({
        calendarId: CAL,
        title: 'Reunião',
        startAt: '2026-02-10T09:00:00Z',
        endAt: '2026-02-10T10:00:00Z',
      });
    expect(res.status).toBe(201);
    expect(res.body.event.priority).toBe('medium');
  });

  it('aceita metadata.dueAction válido (persistido)', async () => {
    const res = await request(makeApp())
      .post('/api/events')
      .set('x-test-auth', '1')
      .send({
        calendarId: CAL,
        title: 'Disparar flow ao vencer',
        startAt: '2026-02-10T09:00:00Z',
        endAt: '2026-02-10T10:00:00Z',
        type: 'follow_up',
        metadata: {
          dueAction: { kind: 'trigger_flow', flowId: '00000000-0000-0000-0000-0000000000c1' },
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.event.metadata.dueAction.kind).toBe('trigger_flow');
  });

  it('type inválido → 400', async () => {
    const res = await request(makeApp())
      .post('/api/events')
      .set('x-test-auth', '1')
      .send({
        calendarId: CAL,
        title: 'x',
        startAt: '2026-02-10T09:00:00Z',
        endAt: '2026-02-10T10:00:00Z',
        type: 'nao_existe',
      });
    expect(res.status).toBe(400);
  });

  it('dueAction.kind inválido → 400', async () => {
    const res = await request(makeApp())
      .post('/api/events')
      .set('x-test-auth', '1')
      .send({
        calendarId: CAL,
        title: 'x',
        startAt: '2026-02-10T09:00:00Z',
        endAt: '2026-02-10T10:00:00Z',
        metadata: { dueAction: { kind: 'explodir' } },
      });
    expect(res.status).toBe(400);
  });
});

// ─── 3. PUT /api/events/:id — transições de status ───────────────────────────────
describe('PUT /api/events/:id — máquina de transição', () => {
  it('transição válida scheduled → completed → 200', async () => {
    seedEvent({ status: 'scheduled' });
    const res = await request(makeApp())
      .put(`/api/events/${EVT}`)
      .set('x-test-auth', '1')
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.event.status).toBe('completed');
  });

  it('aceita priority no PUT', async () => {
    seedEvent({ status: 'scheduled', priority: 'low' });
    const res = await request(makeApp())
      .put(`/api/events/${EVT}`)
      .set('x-test-auth', '1')
      .send({ priority: 'high' });
    expect(res.status).toBe(200);
    expect(res.body.event.priority).toBe('high');
  });

  it('transição inválida (de completed, terminal) → 422 com mensagem PT-BR', async () => {
    seedEvent({ status: 'completed' });
    const res = await request(makeApp())
      .put(`/api/events/${EVT}`)
      .set('x-test-auth', '1')
      .send({ status: 'scheduled' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_transition');
    expect(res.body.message).toMatch(/concluído/);
  });

  it('postergar sem horário futuro → 422 invalid_postpone', async () => {
    seedEvent({ status: 'scheduled', startAt: new Date('2020-01-01T10:00:00Z') });
    const res = await request(makeApp())
      .put(`/api/events/${EVT}`)
      .set('x-test-auth', '1')
      .send({ status: 'postponed' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_postpone');
  });

  it('postergar com novo startAt futuro → 200', async () => {
    seedEvent({ status: 'scheduled' });
    const future = new Date(Date.now() + 86_400_000);
    const futureEnd = new Date(future.getTime() + 3_600_000);
    const res = await request(makeApp())
      .put(`/api/events/${EVT}`)
      .set('x-test-auth', '1')
      .send({ status: 'postponed', startAt: future.toISOString(), endAt: futureEnd.toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.event.status).toBe('postponed');
  });
});
