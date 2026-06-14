/**
 * Testes da API de estado da conversa (F30-S02).
 *
 * Cobre:
 *  - POST /api/conversations/:id/status   — happy path, authz 403, Zod 400
 *  - POST /api/conversations/:id/ai-mode  — happy path, authz 403, Zod 400
 *
 * Estratégia: mocks de `@hm/db`, `@hm/shared/mq` e `../../middlewares/auth`
 * — sem Docker/Postgres necessário. O relay AMQP é best-effort (allSettled);
 * a falha de broker não derruba a operação — mockamos sendToQueue mas não
 * precisamos asserta-la.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks de infra ───────────────────────────────────────────────────────────

const sendToQueueMock = vi.fn();
const connectMqMock = vi.fn().mockResolvedValue({
  channel: { sendToQueue: sendToQueueMock },
  connection: {},
});

vi.mock('@hm/shared/mq', () => ({
  connectMq: (...args: unknown[]) => connectMqMock(...args),
  makeEnvelope: (_type: string, _ws: string, payload: unknown) => payload,
}));

// Conversas em memória para o mock de DB.
const CONV_ID = '00000000-0000-0000-0000-000000000c01';
const MEMBER_OWNER = '00000000-0000-0000-0000-000000000001';
const MEMBER_AGENT = '00000000-0000-0000-0000-000000000002';
const MEMBER_OTHER = '00000000-0000-0000-0000-000000000003';

/** Estado mutável da conversa usada nos testes. */
let convRow: { assignedTo: string | null } | null = { assignedTo: MEMBER_AGENT };

vi.mock('@hm/db', () => ({
  schema: {
    conversations: {
      id: 'id',
      assignedTo: 'assignedTo',
      status: 'status',
      snoozedUntil: 'snoozedUntil',
      aiMode: 'aiMode',
      aiPausedReason: 'aiPausedReason',
      aiPausedAt: 'aiPausedAt',
      aiPausedBy: 'aiPausedBy',
      aiResumeAt: 'aiResumeAt',
      updatedAt: 'updatedAt',
    },
  },
}));

// ─── Mock de auth ─────────────────────────────────────────────────────────────

type MockAuth = { role: string; memberId: string };
let mockAuth: MockAuth = { role: 'OWNER', memberId: MEMBER_OWNER };

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers['x-test-auth'] !== '1') {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    (req as { auth?: unknown }).auth = {
      workspace: { id: 'ws-test' },
      member: { role: mockAuth.role, id: mockAuth.memberId },
    };
    next();
  },
  withRLS: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    // Stub do scoped: executa o callback com um tx fake que imita Drizzle.
    (req as { scoped?: unknown }).scoped = async (
      fn: (tx: MockTx) => Promise<unknown>,
    ) => fn(makeTx());
    next();
  },
  requireRole: (perm: string) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Importa can() real do @hm/shared para validar a permissão.
    // Evitamos importação top-level aqui para não circular com o módulo mockado.
    const role = (req as { auth?: { member?: { role?: string } } }).auth?.member?.role ?? '';
    // Permissões STAFF: OWNER, ADMIN, SUPERVISOR, AGENT. READONLY nunca.
    const STAFF = ['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT'] as const;
    type StaffRole = (typeof STAFF)[number];
    const staffSet = new Set<string>(STAFF);
    // Permissões conhecidas deste slot são todas STAFF.
    const staffPerms = new Set([
      'conversation.resolve',
      'conversation.snooze',
      'conversation.ai_mode',
      'conversation.view',
    ]);
    if (staffPerms.has(perm) && !staffSet.has(role)) {
      res.status(403).json({ message: `Sem permissão: ${perm}` });
      return;
    }
    next();
    // Keep TS happy.
    void (perm as unknown as StaffRole);
  },
}));

// ─── Tx fake ──────────────────────────────────────────────────────────────────

type MockTx = ReturnType<typeof makeTx>;

function makeTx() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (_n: number) => (convRow ? [convRow] : []),
        }),
      }),
    }),
    update: (_table: unknown) => ({
      set: (_data: unknown) => ({
        where: (_cond: unknown) => Promise.resolve(),
      }),
    }),
  };
}

// ─── App de teste ─────────────────────────────────────────────────────────────

const { createConversationStateRouter } = await import('./state');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(createConversationStateRouter());
  return app;
}

// ─── Testes ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  convRow = { assignedTo: MEMBER_AGENT };
  mockAuth = { role: 'OWNER', memberId: MEMBER_OWNER };
});

// ─── POST /api/conversations/:id/status ──────────────────────────────────────

describe('POST /api/conversations/:id/status', () => {
  it('sem sessão → 401', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/status`)
      .send({ status: 'resolved' });
    expect(res.status).toBe(401);
  });

  it('body sem status → 400', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/status`)
      .set('x-test-auth', '1')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('issues');
  });

  it('status inválido (valor fora do enum) → 400', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/status`)
      .set('x-test-auth', '1')
      .send({ status: 'banana' });
    expect(res.status).toBe(400);
  });

  it('snooze sem snoozedUntil → 400', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/status`)
      .set('x-test-auth', '1')
      .send({ status: 'snoozed' });
    expect(res.status).toBe(400);
  });

  it('snooze com snoozedUntil no passado → 400', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/status`)
      .set('x-test-auth', '1')
      .send({ status: 'snoozed', snoozedUntil: past });
    expect(res.status).toBe(400);
  });

  it('READONLY não pode resolver → 403', async () => {
    mockAuth = { role: 'READONLY', memberId: MEMBER_OWNER };
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/status`)
      .set('x-test-auth', '1')
      .send({ status: 'resolved' });
    expect(res.status).toBe(403);
  });

  it('AGENT em conversa não atribuída a ele → 403', async () => {
    mockAuth = { role: 'AGENT', memberId: MEMBER_OTHER };
    convRow = { assignedTo: MEMBER_AGENT }; // atribuída a outro agent
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/status`)
      .set('x-test-auth', '1')
      .send({ status: 'resolved' });
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('message');
  });

  it('conversa não encontrada → 404', async () => {
    convRow = null;
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/status`)
      .set('x-test-auth', '1')
      .send({ status: 'resolved' });
    expect(res.status).toBe(404);
  });

  it('OWNER resolve → 200 com { conversationId, status }', async () => {
    mockAuth = { role: 'OWNER', memberId: MEMBER_OWNER };
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/status`)
      .set('x-test-auth', '1')
      .send({ status: 'resolved' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ conversationId: CONV_ID, status: 'resolved' });
  });

  it('AGENT resolve conversa atribuída a ele → 200', async () => {
    mockAuth = { role: 'AGENT', memberId: MEMBER_AGENT };
    convRow = { assignedTo: MEMBER_AGENT };
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/status`)
      .set('x-test-auth', '1')
      .send({ status: 'resolved' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ conversationId: CONV_ID, status: 'resolved' });
  });

  it('snooze futuro válido → 200 com snoozedUntil', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/status`)
      .set('x-test-auth', '1')
      .send({ status: 'snoozed', snoozedUntil: future });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ conversationId: CONV_ID, status: 'snoozed' });
    expect(res.body.snoozedUntil).toBeTruthy();
  });

  it('reabrir (open) limpa snoozedUntil no response', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/status`)
      .set('x-test-auth', '1')
      .send({ status: 'open' });
    expect(res.status).toBe(200);
    expect(res.body.snoozedUntil).toBeNull();
  });
});

// ─── POST /api/conversations/:id/ai-mode ─────────────────────────────────────

describe('POST /api/conversations/:id/ai-mode', () => {
  it('sem sessão → 401', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/ai-mode`)
      .send({ aiMode: 'on' });
    expect(res.status).toBe(401);
  });

  it('body sem aiMode → 400', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/ai-mode`)
      .set('x-test-auth', '1')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('issues');
  });

  it('aiMode inválido (valor fora do enum) → 400', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/ai-mode`)
      .set('x-test-auth', '1')
      .send({ aiMode: 'unknown' });
    expect(res.status).toBe(400);
  });

  it('READONLY não pode alterar ai_mode → 403', async () => {
    mockAuth = { role: 'READONLY', memberId: MEMBER_OWNER };
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/ai-mode`)
      .set('x-test-auth', '1')
      .send({ aiMode: 'on' });
    expect(res.status).toBe(403);
  });

  it('AGENT em conversa não atribuída → 403', async () => {
    mockAuth = { role: 'AGENT', memberId: MEMBER_OTHER };
    convRow = { assignedTo: MEMBER_AGENT };
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/ai-mode`)
      .set('x-test-auth', '1')
      .send({ aiMode: 'on' });
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('message');
  });

  it('conversa não encontrada → 404', async () => {
    convRow = null;
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/ai-mode`)
      .set('x-test-auth', '1')
      .send({ aiMode: 'on' });
    expect(res.status).toBe(404);
  });

  it('OWNER liga IA (on) → 200 com { conversationId, aiMode }', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/ai-mode`)
      .set('x-test-auth', '1')
      .send({ aiMode: 'on' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ conversationId: CONV_ID, aiMode: 'on', reason: null });
  });

  it('OWNER desliga IA (off) → 200 com reason null', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/ai-mode`)
      .set('x-test-auth', '1')
      .send({ aiMode: 'off' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ conversationId: CONV_ID, aiMode: 'off', reason: null });
  });

  it('OWNER pausa IA (paused) → 200 com reason=manual', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/ai-mode`)
      .set('x-test-auth', '1')
      .send({ aiMode: 'paused' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      conversationId: CONV_ID,
      aiMode: 'paused',
      reason: 'manual',
    });
  });

  it('AGENT pausa IA em conversa própria → 200', async () => {
    mockAuth = { role: 'AGENT', memberId: MEMBER_AGENT };
    convRow = { assignedTo: MEMBER_AGENT };
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/ai-mode`)
      .set('x-test-auth', '1')
      .send({ aiMode: 'paused' });
    expect(res.status).toBe(200);
    expect(res.body.aiMode).toBe('paused');
    expect(res.body.reason).toBe('manual');
  });
});
