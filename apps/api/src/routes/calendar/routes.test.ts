/**
 * Testes da API de Calendar 2.0 (F37-S02).
 *
 * Dois blocos:
 *  1. Unidade PURA (sem mocks de infra): `canAccessCalendar` (ownership fino) e o
 *     serviço de recorrência (`parseRecurrenceRule`/`expandOccurrences`).
 *  2. Integração de rotas com `@hm/db`, `auth` e `event-service` MOCKADOS — foco na
 *     REGRESSÃO do vazamento L1: um membro comum NÃO recebe calendários/eventos de
 *     calendários inacessíveis; overlay `calendarIds`; expansão de recorrência na
 *     janela; provisionamento idempotente.
 *
 * Estratégia espelha state.test.ts (mocks hoisted, tx fake, x-test-auth header).
 */
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DrizzleOrm from 'drizzle-orm';

// ─── IDs fixos ────────────────────────────────────────────────────────────────
const WS = '00000000-0000-0000-0000-0000000000ff';
const CAL_PERSONAL_ME = '00000000-0000-0000-0000-0000000000a1';
const CAL_PERSONAL_OTHER = '00000000-0000-0000-0000-0000000000a2';
const CAL_WORKSPACE = '00000000-0000-0000-0000-0000000000a3';
const MEMBER_ME = '00000000-0000-0000-0000-0000000000b1';
const MEMBER_OTHER = '00000000-0000-0000-0000-0000000000b2';

const EVT_MINE = '00000000-0000-0000-0000-0000000000e1';
const EVT_OTHER = '00000000-0000-0000-0000-0000000000e2';
const EVT_RECUR = '00000000-0000-0000-0000-0000000000e3';

type CalRow = {
  id: string;
  workspaceId: string;
  name: string;
  type: 'personal' | 'team' | 'workspace';
  ownerId: string | null;
  teamId: string | null;
  color: string;
  description: string | null;
  timezone: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date | null;
};

type EvtRow = {
  id: string;
  workspaceId: string;
  calendarId: string;
  title: string;
  type: string;
  startAt: Date;
  endAt: Date;
  status: string;
  description: string | null;
  location: string | null;
  meetingUrl: string | null;
  contactId: string | null;
  dealId: string | null;
  conversationId: string | null;
  createdBy: string | null;
  createdByAgentId: string | null;
  recurrenceRule: string | null;
  recurrenceUntil: Date | null;
  recurrenceParentId: string | null;
  metadata: Record<string, unknown>;
};

function cal(partial: Partial<CalRow> & Pick<CalRow, 'id' | 'type'>): CalRow {
  return {
    workspaceId: WS,
    name: 'cal',
    ownerId: null,
    teamId: null,
    color: '#1FFF13',
    description: null,
    timezone: 'America/Sao_Paulo',
    isDefault: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: null,
    ...partial,
  };
}

function evt(partial: Partial<EvtRow> & Pick<EvtRow, 'id' | 'calendarId' | 'startAt' | 'endAt'>): EvtRow {
  return {
    workspaceId: WS,
    title: 'evt',
    type: 'meeting',
    status: 'scheduled',
    description: null,
    location: null,
    meetingUrl: null,
    contactId: null,
    dealId: null,
    conversationId: null,
    createdBy: null,
    createdByAgentId: null,
    recurrenceRule: null,
    recurrenceUntil: null,
    recurrenceParentId: null,
    metadata: {},
    ...partial,
  };
}

// ─── Estado mutável dos mocks ──────────────────────────────────────────────────
const ALL_CALENDARS: CalRow[] = [
  cal({ id: CAL_PERSONAL_ME, type: 'personal', ownerId: MEMBER_ME, name: 'Meu' }),
  cal({ id: CAL_PERSONAL_OTHER, type: 'personal', ownerId: MEMBER_OTHER, name: 'Colega' }),
  cal({ id: CAL_WORKSPACE, type: 'workspace', name: 'Empresa', isDefault: true }),
];

let ALL_EVENTS: EvtRow[] = [];

/** Conjunto de calendários que o repo mockado considera acessíveis (controlado por teste). */
let accessibleIds: string[] = [];
const ensurePersonalMock = vi.fn<(...args: unknown[]) => Promise<CalRow>>(
  async () => ALL_CALENDARS[0]!,
);
const ensureWorkspaceMock = vi.fn<(...args: unknown[]) => Promise<CalRow>>(
  async () => ALL_CALENDARS[2]!,
);
const accessibleIdsMock = vi.fn<(...args: unknown[]) => Promise<string[]>>(
  async () => accessibleIds,
);

// ─── Mock de @hm/db ────────────────────────────────────────────────────────────
// tx fake que entende as queries usadas pelos handlers:
//  - select().from(calendars).where(...).orderBy(...)  -> filtra ALL_CALENDARS pelo último inArray
//  - select().from(events).where(...).orderBy(...)      -> filtra ALL_EVENTS pelo último inArray
// A semântica de visibilidade real está no calendarRepo (mockado): os handlers SÓ
// consultam ids vindos de accessibleCalendarIds; o tx só materializa as linhas.

vi.mock('@hm/db', () => {
  // Tabelas mockadas carregam __name p/ o tx fake discriminar select().from(...).
  const calendars = { __name: 'calendars', id: 'id', type: 'type', isDefault: 'isDefault', name: 'name' };
  const events = {
    __name: 'events',
    id: 'id',
    calendarId: 'calendarId',
    contactId: 'contactId',
    startAt: 'startAt',
    endAt: 'endAt',
    recurrenceRule: 'recurrenceRule',
  };
  return {
    schema: { calendars, events, eventParticipants: {} },
    calendarRepo: {
      ensurePersonalCalendar: (...a: unknown[]) => ensurePersonalMock(...a),
      ensureWorkspaceCalendar: (...a: unknown[]) => ensureWorkspaceMock(...a),
      accessibleCalendarIds: (...a: unknown[]) => accessibleIdsMock(...a),
    },
  };
});

// ─── Mock do event-service (POST não toca DB real) ─────────────────────────────
const createEventMock = vi.fn();
vi.mock('../../services/event-service', () => ({
  EventServiceError: class extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  createEvent: (...a: unknown[]) => createEventMock(...a),
  cancelEvent: vi.fn(),
  setRsvp: vi.fn(),
}));

// ─── Mock de auth ──────────────────────────────────────────────────────────────
let mockAuth = { role: 'AGENT', memberId: MEMBER_ME };

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers['x-test-auth'] !== '1') {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    (req as { auth?: unknown }).auth = {
      workspace: { id: WS, timezone: 'America/Sao_Paulo' },
      member: { role: mockAuth.role, id: mockAuth.memberId },
    };
    next();
  },
  withRLS: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as { scoped?: unknown }).scoped = async (fn: (tx: MockTx) => Promise<unknown>) =>
      fn(makeTx());
    next();
  },
  requireRole:
    (_perm: string) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const role = (req as { auth?: { member?: { role?: string } } }).auth?.member?.role ?? '';
      if (role === 'READONLY' && _perm !== 'calendar.view') {
        res.status(403).json({ message: `Sem permissão: ${_perm}` });
        return;
      }
      next();
    },
}));

// ─── tx fake ───────────────────────────────────────────────────────────────────
type MockTx = ReturnType<typeof makeTx>;

/** Extrai os ids de um inArray fake. Os handlers só passam inArray(col, ids[]). */
type Cond = { __ids?: string[] } | undefined;

function makeTx() {
  // Encadeamento: select(...).from(table).where(cond).orderBy(...)  (thenable)
  function builder(table: 'calendars' | 'events') {
    let cond: Cond;
    const chain = {
      from: (_t: unknown) => chain,
      where: (c: Cond) => {
        cond = c;
        return chain;
      },
      orderBy: (..._a: unknown[]) => chain,
      then: (resolve: (rows: unknown[]) => unknown) => {
        const ids = cond?.__ids ?? null;
        if (table === 'calendars') {
          const rows = ids ? ALL_CALENDARS.filter((c) => ids.includes(c.id)) : ALL_CALENDARS;
          return Promise.resolve(rows).then(resolve);
        }
        const rows = ids ? ALL_EVENTS.filter((e) => ids.includes(e.calendarId)) : ALL_EVENTS;
        return Promise.resolve(rows).then(resolve);
      },
    };
    return chain;
  }
  return {
    select: (_cols?: unknown) => ({
      from: (table: unknown) =>
        builder((table as { __name?: string }).__name === 'events' ? 'events' : 'calendars'),
    }),
  };
}

// inArray do drizzle é mockado p/ carregar os ids dentro do cond fake.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof DrizzleOrm>();
  return {
    ...actual,
    inArray: (_col: unknown, ids: string[]) => ({ __ids: ids }),
    and: (...conds: Cond[]) => {
      // O AND combina os predicados; o relevante p/ o fake é o inArray de ids.
      const withIds = conds.find((c) => c && '__ids' in c);
      return withIds ?? conds[0];
    },
    or: (...conds: unknown[]) => conds[0],
    eq: () => ({}),
    gte: () => ({}),
    lte: () => ({}),
    isNotNull: () => ({}),
    asc: () => ({}),
    desc: () => ({}),
  };
});

// ─── App ───────────────────────────────────────────────────────────────────────
const { createCalendarsRouter } = await import('./calendars');
const { createEventsRouter } = await import('./events');
const { canAccessCalendar } = await import('../../middlewares/calendar-access');
const recurrence = await import('../../services/calendar-recurrence');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(createCalendarsRouter());
  app.use(createEventsRouter());
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  ALL_EVENTS = [];
  accessibleIds = [];
  mockAuth = { role: 'AGENT', memberId: MEMBER_ME };
  ensurePersonalMock.mockResolvedValue(ALL_CALENDARS[0]!);
  ensureWorkspaceMock.mockResolvedValue(ALL_CALENDARS[2]!);
  accessibleIdsMock.mockImplementation(async () => accessibleIds);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── 1. Autorização (sem sessão) ────────────────────────────────────────────────
describe('rotas de calendar — autorização', () => {
  it('GET /api/calendars sem sessão → 401', async () => {
    expect((await request(makeApp()).get('/api/calendars')).status).toBe(401);
  });
  it('GET /api/events sem sessão → 401', async () => {
    expect((await request(makeApp()).get('/api/events')).status).toBe(401);
  });
  it('POST /api/events sem sessão → 401', async () => {
    expect((await request(makeApp()).post('/api/events').send({})).status).toBe(401);
  });
});

// ─── 2. canAccessCalendar (ownership fino, puro) ────────────────────────────────
describe('canAccessCalendar (ownership fino §8)', () => {
  it('workspace → qualquer member', () => {
    const c = cal({ id: CAL_WORKSPACE, type: 'workspace' });
    expect(canAccessCalendar(c, { id: MEMBER_ME, role: 'AGENT' })).toBe(true);
    expect(canAccessCalendar(c, { id: MEMBER_ME, role: 'READONLY' })).toBe(true);
  });
  it('personal → dono ou admin; NÃO outros agents', () => {
    const c = cal({ id: CAL_PERSONAL_OTHER, type: 'personal', ownerId: MEMBER_OTHER });
    expect(canAccessCalendar(c, { id: MEMBER_OTHER, role: 'AGENT' })).toBe(true);
    expect(canAccessCalendar(c, { id: MEMBER_ME, role: 'ADMIN' })).toBe(true);
    expect(canAccessCalendar(c, { id: MEMBER_ME, role: 'AGENT' })).toBe(false);
  });
  it('team → não decidível no puro (delegado ao repo) → false', () => {
    const c = cal({ id: 'x', type: 'team', teamId: 't1' });
    expect(canAccessCalendar(c, { id: MEMBER_ME, role: 'SUPERVISOR' })).toBe(false);
    expect(canAccessCalendar(c, { id: MEMBER_ME, role: 'AGENT' })).toBe(false);
  });
});

// ─── 3. REGRESSÃO do vazamento L1 ───────────────────────────────────────────────
describe('REGRESSÃO L1 — visibilidade escopada por accessibleCalendarIds', () => {
  it('GET /api/calendars: membro comum NÃO vê o pessoal de colegas', async () => {
    // accessibleCalendarIds devolve só o pessoal do membro + o workspace.
    accessibleIds = [CAL_PERSONAL_ME, CAL_WORKSPACE];
    const res = await request(makeApp()).get('/api/calendars').set('x-test-auth', '1');
    expect(res.status).toBe(200);
    const ids = (res.body.calendars as CalRow[]).map((c) => c.id);
    expect(ids).toContain(CAL_PERSONAL_ME);
    expect(ids).toContain(CAL_WORKSPACE);
    expect(ids).not.toContain(CAL_PERSONAL_OTHER); // <- não vaza o pessoal do colega
  });

  it('GET /api/calendars: provisiona pessoal + Empresa (idempotente) ao listar', async () => {
    accessibleIds = [CAL_PERSONAL_ME, CAL_WORKSPACE];
    await request(makeApp()).get('/api/calendars').set('x-test-auth', '1');
    expect(ensurePersonalMock).toHaveBeenCalledTimes(1);
    expect(ensureWorkspaceMock).toHaveBeenCalledTimes(1);
  });

  it('GET /api/events: membro comum NÃO recebe eventos de calendário inacessível', async () => {
    accessibleIds = [CAL_PERSONAL_ME, CAL_WORKSPACE];
    ALL_EVENTS = [
      evt({
        id: EVT_MINE,
        calendarId: CAL_PERSONAL_ME,
        startAt: new Date('2026-02-10T10:00:00Z'),
        endAt: new Date('2026-02-10T11:00:00Z'),
      }),
      evt({
        id: EVT_OTHER,
        calendarId: CAL_PERSONAL_OTHER, // pessoal do colega -> NÃO acessível
        startAt: new Date('2026-02-10T12:00:00Z'),
        endAt: new Date('2026-02-10T13:00:00Z'),
      }),
    ];
    const res = await request(makeApp()).get('/api/events').set('x-test-auth', '1');
    expect(res.status).toBe(200);
    const ids = (res.body.events as EvtRow[]).map((e) => e.id);
    expect(ids).toContain(EVT_MINE);
    expect(ids).not.toContain(EVT_OTHER); // <- vazamento fechado
  });

  it('GET /api/events sem nenhum calendário acessível → lista vazia', async () => {
    accessibleIds = [];
    ALL_EVENTS = [
      evt({
        id: EVT_OTHER,
        calendarId: CAL_PERSONAL_OTHER,
        startAt: new Date('2026-02-10T12:00:00Z'),
        endAt: new Date('2026-02-10T13:00:00Z'),
      }),
    ];
    const res = await request(makeApp()).get('/api/events').set('x-test-auth', '1');
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
  });
});

// ─── 4. Overlay calendarIds ─────────────────────────────────────────────────────
describe('overlay calendarIds', () => {
  it('calendarIds=CSV restringe ao subconjunto acessível pedido', async () => {
    accessibleIds = [CAL_PERSONAL_ME, CAL_WORKSPACE];
    ALL_EVENTS = [
      evt({
        id: EVT_MINE,
        calendarId: CAL_PERSONAL_ME,
        startAt: new Date('2026-02-10T10:00:00Z'),
        endAt: new Date('2026-02-10T11:00:00Z'),
      }),
      evt({
        id: 'evt-ws',
        calendarId: CAL_WORKSPACE,
        startAt: new Date('2026-02-10T14:00:00Z'),
        endAt: new Date('2026-02-10T15:00:00Z'),
      }),
    ];
    const res = await request(makeApp())
      .get(`/api/events?calendarIds=${CAL_PERSONAL_ME}`)
      .set('x-test-auth', '1');
    const ids = (res.body.events as EvtRow[]).map((e) => e.id);
    expect(ids).toContain(EVT_MINE);
    expect(ids).not.toContain('evt-ws'); // pedido só o pessoal -> workspace fica de fora
  });

  it('calendarIds com um id INACESSÍVEL é descartado (nunca vaza)', async () => {
    accessibleIds = [CAL_PERSONAL_ME, CAL_WORKSPACE];
    ALL_EVENTS = [
      evt({
        id: EVT_OTHER,
        calendarId: CAL_PERSONAL_OTHER,
        startAt: new Date('2026-02-10T12:00:00Z'),
        endAt: new Date('2026-02-10T13:00:00Z'),
      }),
    ];
    const res = await request(makeApp())
      .get(`/api/events?calendarIds=${CAL_PERSONAL_OTHER}`)
      .set('x-test-auth', '1');
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]); // pediu o inacessível -> interseção vazia
  });

  it('GET /api/events/:id de calendário INACESSÍVEL -> 404 (não vaza o detalhe)', async () => {
    accessibleIds = [CAL_PERSONAL_ME, CAL_WORKSPACE];
    ALL_EVENTS = [
      evt({
        id: EVT_OTHER,
        calendarId: CAL_PERSONAL_OTHER,
        startAt: new Date('2026-02-10T12:00:00Z'),
        endAt: new Date('2026-02-10T13:00:00Z'),
      }),
    ];
    const res = await request(makeApp())
      .get(`/api/events/${EVT_OTHER}`)
      .set('x-test-auth', '1');
    expect(res.status).toBe(404); // detalhe escopado por accessibleCalendarIds
  });
});

// ─── 5. Expansão de recorrência na janela ───────────────────────────────────────
describe('expansão de recorrência na janela from/to', () => {
  it('GET /api/events expande série DAILY dentro da janela', async () => {
    accessibleIds = [CAL_PERSONAL_ME];
    ALL_EVENTS = [
      evt({
        id: EVT_RECUR,
        calendarId: CAL_PERSONAL_ME,
        startAt: new Date('2026-02-10T09:00:00Z'),
        endAt: new Date('2026-02-10T10:00:00Z'),
        recurrenceRule: 'FREQ=DAILY;UNTIL=2026-02-13T00:00:00Z',
      }),
    ];
    const res = await request(makeApp())
      .get('/api/events?from=2026-02-10T00:00:00Z&to=2026-02-12T23:59:59Z')
      .set('x-test-auth', '1');
    expect(res.status).toBe(200);
    const list = res.body.events as EvtRow[];
    // 10, 11, 12 (UNTIL 13 mas janela termina 12) -> 3 ocorrências sintéticas.
    expect(list.length).toBe(3);
    for (const o of list) {
      expect(o.id).toMatch(/^evt:.*:.*/);
      expect(o.recurrenceParentId).toBe(EVT_RECUR);
    }
  });

  it('evento simples não é expandido (1 instância)', async () => {
    accessibleIds = [CAL_PERSONAL_ME];
    ALL_EVENTS = [
      evt({
        id: EVT_MINE,
        calendarId: CAL_PERSONAL_ME,
        startAt: new Date('2026-02-10T09:00:00Z'),
        endAt: new Date('2026-02-10T10:00:00Z'),
      }),
    ];
    const res = await request(makeApp())
      .get('/api/events?from=2026-02-10T00:00:00Z&to=2026-02-12T23:59:59Z')
      .set('x-test-auth', '1');
    const list = res.body.events as EvtRow[];
    expect(list.length).toBe(1);
    expect(list[0]!.id).toBe(EVT_MINE);
  });
});

// ─── 6. POST default calendar + recorrência ─────────────────────────────────────
describe('POST /api/events', () => {
  it('aceita recurrenceRule e calendarId ausente (default pessoal via service)', async () => {
    createEventMock.mockImplementation(async (_tx, input) => ({
      id: 'new-evt',
      ...input,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
    }));
    const res = await request(makeApp())
      .post('/api/events')
      .set('x-test-auth', '1')
      .send({
        title: 'Daily standup',
        startAt: '2026-02-10T09:00:00Z',
        endAt: '2026-02-10T09:15:00Z',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      });
    expect(res.status).toBe(201);
    expect(createEventMock).toHaveBeenCalledTimes(1);
    const input = createEventMock.mock.calls[0]![1] as { calendarId: string | null; recurrenceRule: string | null };
    expect(input.calendarId).toBeNull(); // service resolve o pessoal
    expect(input.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
  });

  it('recurrenceRule inválido → 400', async () => {
    const res = await request(makeApp())
      .post('/api/events')
      .set('x-test-auth', '1')
      .send({
        title: 'x',
        startAt: '2026-02-10T09:00:00Z',
        endAt: '2026-02-10T10:00:00Z',
        recurrenceRule: 'FREQ=YEARLY',
      });
    expect(res.status).toBe(400);
  });
});

// ─── 7. Serviço de recorrência (puro) ───────────────────────────────────────────
describe('calendar-recurrence (puro)', () => {
  const { parseRecurrenceRule, expandOccurrences } = recurrence;

  it('parse DAILY/WEEKLY válidos e rejeita inválidos', () => {
    expect(parseRecurrenceRule('FREQ=DAILY')?.freq).toBe('DAILY');
    expect(parseRecurrenceRule('FREQ=WEEKLY;BYDAY=MO,WE')?.byDay).toEqual([1, 3]);
    expect(parseRecurrenceRule('FREQ=WEEKLY;INTERVAL=2')?.interval).toBe(2);
    expect(parseRecurrenceRule('')).toBeNull();
    expect(parseRecurrenceRule('FREQ=YEARLY')).toBeNull();
    expect(parseRecurrenceRule('FREQ=WEEKLY;BYDAY=XX')).toBeNull();
    expect(parseRecurrenceRule(null)).toBeNull();
  });

  it('expandOccurrences DAILY recorta na janela e usa id sintético', () => {
    const base = {
      id: 'm1',
      startAt: new Date('2026-02-10T09:00:00Z'),
      endAt: new Date('2026-02-10T10:00:00Z'),
      recurrenceRule: 'FREQ=DAILY',
      recurrenceUntil: null,
    };
    const out = expandOccurrences(
      base,
      new Date('2026-02-11T00:00:00Z'),
      new Date('2026-02-13T23:59:59Z'),
    );
    expect(out.map((o) => o.startAt.toISOString())).toEqual([
      '2026-02-11T09:00:00.000Z',
      '2026-02-12T09:00:00.000Z',
      '2026-02-13T09:00:00.000Z',
    ]);
    expect(out[0]!.id).toBe('evt:m1:2026-02-11T09:00:00.000Z');
  });

  it('expandOccurrences WEEKLY/BYDAY filtra os dias', () => {
    // 2026-02-09 é segunda-feira (UTC).
    const base = {
      id: 'm2',
      startAt: new Date('2026-02-09T09:00:00Z'),
      endAt: new Date('2026-02-09T10:00:00Z'),
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE',
      recurrenceUntil: null,
    };
    const out = expandOccurrences(
      base,
      new Date('2026-02-09T00:00:00Z'),
      new Date('2026-02-15T23:59:59Z'),
    );
    // Mon 09, Wed 11 (na mesma semana). Os dias retornados respeitam o BYDAY.
    const days = out.map((o) => o.startAt.getUTCDate()).sort((a, b) => a - b);
    expect(days).toEqual([9, 11]);
  });

  it('evento sem recorrência fora da janela → vazio', () => {
    const base = {
      id: 'm3',
      startAt: new Date('2026-01-01T09:00:00Z'),
      endAt: new Date('2026-01-01T10:00:00Z'),
      recurrenceRule: null,
      recurrenceUntil: null,
    };
    expect(
      expandOccurrences(base, new Date('2026-02-01T00:00:00Z'), new Date('2026-02-28T00:00:00Z')),
    ).toEqual([]);
  });
});
