/**
 * Testes da API de troca manual de agente (F34-S04).
 *
 * Cobre:
 *  - GET  /api/conversations/:id/agent  — candidatos + agente atual; authz; 404.
 *  - POST /api/conversations/:id/agent  — happy path, elegibilidade (422), authz
 *    (401/403/404), Zod (400), fallback sem-departamento.
 *
 * Estratégia (espelha state.test.ts): mocks de `@hm/db`, `@hm/shared/mq` e
 * `../../middlewares/auth` — sem Docker/Postgres. O relay e o re-engajamento são
 * best-effort (allSettled) sobre o mesmo `sendToQueue` mockado.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Identificadores ───────────────────────────────────────────────────────────
const CONV_ID = '00000000-0000-0000-0000-000000000c01';
const MEMBER_OWNER = '00000000-0000-0000-0000-000000000001';
const MEMBER_AGENT = '00000000-0000-0000-0000-000000000002';
const MEMBER_OTHER = '00000000-0000-0000-0000-000000000003';
const DEPT_ID = '00000000-0000-0000-0000-0000000000d1';
const AGENT_A = '00000000-0000-0000-0000-0000000000a1';
const AGENT_B = '00000000-0000-0000-0000-0000000000a2';
const AGENT_OUTSIDER = '00000000-0000-0000-0000-0000000000a9';

// ─── Mocks de infra ───────────────────────────────────────────────────────────
const { assertVisibleMock, listAgentsForDepartmentMock } = vi.hoisted(() => ({
  assertVisibleMock: vi.fn(),
  listAgentsForDepartmentMock: vi.fn(),
}));

const sendToQueueMock = vi.fn();
const connectMqMock = vi.fn().mockResolvedValue({
  channel: { sendToQueue: sendToQueueMock },
  connection: {},
});

vi.mock('@hm/shared/mq', () => ({
  connectMq: (...args: unknown[]) => connectMqMock(...args),
  makeEnvelope: (type: string, _ws: string, payload: unknown) => ({ type, payload }),
}));

// Estado mutável da conversa.
let convRow: {
  assignedTo: string | null;
  departmentId: string | null;
  contactId: string | null;
  channelId: string | null;
  agentId: string | null;
} | null;

// Agentes ativos do workspace (o select de schema.agents).
const ACTIVE_AGENTS = [
  { id: AGENT_A, name: 'Vendas IA' },
  { id: AGENT_B, name: 'Suporte IA' },
  { id: AGENT_OUTSIDER, name: 'Financeiro IA' },
];

// Sentinelas de tabela: o tx fake discrimina o select pela referência da tabela.
const TBL = {
  conversations: { __t: 'conversations' },
  channels: { __t: 'channels' },
  agents: { __t: 'agents' },
} as const;

vi.mock('@hm/db', () => ({
  schema: {
    conversations: {
      ...TBL.conversations,
      id: 'id',
      assignedTo: 'assignedTo',
      departmentId: 'departmentId',
      contactId: 'contactId',
      channelId: 'channelId',
      agentId: 'agentId',
      aiMode: 'aiMode',
      aiPausedReason: 'aiPausedReason',
      aiPausedAt: 'aiPausedAt',
      aiPausedBy: 'aiPausedBy',
      aiResumeAt: 'aiResumeAt',
      updatedAt: 'updatedAt',
    },
    channels: { ...TBL.channels, id: 'id', provider: 'provider' },
    agents: { ...TBL.agents, id: 'id', name: 'name', status: 'status' },
  },
  assertConversationVisible: assertVisibleMock,
  agentDepartmentsRepo: {
    listAgentsForDepartment: (...args: unknown[]) => listAgentsForDepartmentMock(...args),
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
    (req as { scoped?: unknown }).scoped = async (fn: (tx: MockTx) => Promise<unknown>) =>
      fn(makeTx());
    next();
  },
  requireRole:
    (perm: string) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const role = (req as { auth?: { member?: { role?: string } } }).auth?.member?.role ?? '';
      const STAFF = new Set(['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT']);
      // conversation.assign_agent é STAFF (READONLY nunca).
      if (perm === 'conversation.assign_agent' && !STAFF.has(role)) {
        res.status(403).json({ message: `Sem permissão: ${perm}` });
        return;
      }
      next();
    },
}));

// ─── Tx fake ──────────────────────────────────────────────────────────────────
type MockTx = ReturnType<typeof makeTx>;

function selectResult(table: unknown): unknown[] {
  const marker = (table as { __t?: string } | null)?.__t;
  if (marker === 'conversations') return convRow ? [convRow] : [];
  if (marker === 'channels') return [{ provider: 'meta_whatsapp' }];
  if (marker === 'agents') return ACTIVE_AGENTS;
  return [];
}

function makeTx() {
  return {
    select: (_cols?: unknown) => ({
      from: (table: unknown) => {
        const rows = selectResult(table);
        const chain = {
          where: (_cond?: unknown) => chain,
          limit: (_n?: number) => rows,
          then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
        };
        return chain;
      },
    }),
    update: (_table: unknown) => ({
      set: (_data: unknown) => ({ where: (_cond: unknown) => Promise.resolve() }),
    }),
  };
}

// ─── App de teste ─────────────────────────────────────────────────────────────
const { createConversationAgentRouter } = await import('./agent');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(createConversationAgentRouter());
  return app;
}

// ─── Setup ──────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  assertVisibleMock.mockResolvedValue(true);
  // Por padrão: AGENT_A e AGENT_B atendem o departamento; AGENT_OUTSIDER não.
  listAgentsForDepartmentMock.mockResolvedValue([
    { agentId: AGENT_A, isDefault: true },
    { agentId: AGENT_B, isDefault: false },
  ]);
  convRow = {
    assignedTo: MEMBER_AGENT,
    departmentId: DEPT_ID,
    contactId: '00000000-0000-0000-0000-0000000000ff',
    channelId: '00000000-0000-0000-0000-0000000000ce',
    agentId: AGENT_A,
  };
  mockAuth = { role: 'OWNER', memberId: MEMBER_OWNER };
});

// ─── GET /api/conversations/:id/agent ────────────────────────────────────────
describe('GET /api/conversations/:id/agent', () => {
  it('sem sessão → 401', async () => {
    const res = await request(makeApp()).get(`/api/conversations/${CONV_ID}/agent`);
    expect(res.status).toBe(401);
  });

  it('READONLY → 403', async () => {
    mockAuth = { role: 'READONLY', memberId: MEMBER_OWNER };
    const res = await request(makeApp())
      .get(`/api/conversations/${CONV_ID}/agent`)
      .set('x-test-auth', '1');
    expect(res.status).toBe(403);
  });

  it('conversa invisível → 404', async () => {
    assertVisibleMock.mockResolvedValue(false);
    const res = await request(makeApp())
      .get(`/api/conversations/${CONV_ID}/agent`)
      .set('x-test-auth', '1');
    expect(res.status).toBe(404);
  });

  it('OWNER → 200 com agente atual + candidatos elegíveis (sem o outsider)', async () => {
    const res = await request(makeApp())
      .get(`/api/conversations/${CONV_ID}/agent`)
      .set('x-test-auth', '1');
    expect(res.status).toBe(200);
    expect(res.body.currentAgentId).toBe(AGENT_A);
    expect(res.body.currentAgentName).toBe('Vendas IA');
    const ids = (res.body.candidates as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toEqual([AGENT_A, AGENT_B]);
    expect(ids).not.toContain(AGENT_OUTSIDER);
  });

  it('conversa sem departamento → fallback lista todos os agentes ativos', async () => {
    convRow = { ...convRow!, departmentId: null };
    const res = await request(makeApp())
      .get(`/api/conversations/${CONV_ID}/agent`)
      .set('x-test-auth', '1');
    expect(res.status).toBe(200);
    const ids = (res.body.candidates as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(AGENT_OUTSIDER);
    expect(listAgentsForDepartmentMock).not.toHaveBeenCalled();
  });

  it('AGENT em conversa não atribuída a ele → 403', async () => {
    mockAuth = { role: 'AGENT', memberId: MEMBER_OTHER };
    const res = await request(makeApp())
      .get(`/api/conversations/${CONV_ID}/agent`)
      .set('x-test-auth', '1');
    expect(res.status).toBe(403);
  });
});

// ─── POST /api/conversations/:id/agent ───────────────────────────────────────
describe('POST /api/conversations/:id/agent', () => {
  it('sem sessão → 401', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/agent`)
      .send({ agentId: AGENT_B });
    expect(res.status).toBe(401);
  });

  it('body sem agentId → 400', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/agent`)
      .set('x-test-auth', '1')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('issues');
  });

  it('agentId não-UUID → 400', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/agent`)
      .set('x-test-auth', '1')
      .send({ agentId: 'banana' });
    expect(res.status).toBe(400);
  });

  it('READONLY → 403', async () => {
    mockAuth = { role: 'READONLY', memberId: MEMBER_OWNER };
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/agent`)
      .set('x-test-auth', '1')
      .send({ agentId: AGENT_B });
    expect(res.status).toBe(403);
  });

  it('conversa invisível → 404', async () => {
    assertVisibleMock.mockResolvedValue(false);
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/agent`)
      .set('x-test-auth', '1')
      .send({ agentId: AGENT_B });
    expect(res.status).toBe(404);
  });

  it('AGENT em conversa não atribuída → 403', async () => {
    mockAuth = { role: 'AGENT', memberId: MEMBER_OTHER };
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/agent`)
      .set('x-test-auth', '1')
      .send({ agentId: AGENT_B });
    expect(res.status).toBe(403);
  });

  it('agente não-elegível ao departamento → 422', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/agent`)
      .set('x-test-auth', '1')
      .send({ agentId: AGENT_OUTSIDER });
    expect(res.status).toBe(422);
  });

  it('OWNER troca para agente elegível → 200 + emite socket + re-engaja', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/agent`)
      .set('x-test-auth', '1')
      .send({ agentId: AGENT_B });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ conversationId: CONV_ID, agentId: AGENT_B });
    // 1× relay (conversation:agent_changed) + 1× re-engaje (flow.run.requested).
    expect(sendToQueueMock).toHaveBeenCalledTimes(2);
    const queues = sendToQueueMock.mock.calls.map((c) => c[0]);
    expect(queues).toContain('hm.q.socket.relay');
    expect(queues).toContain('hm.q.flows');
  });

  it('AGENT troca em conversa própria para elegível → 200', async () => {
    mockAuth = { role: 'AGENT', memberId: MEMBER_AGENT };
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/agent`)
      .set('x-test-auth', '1')
      .send({ agentId: AGENT_B });
    expect(res.status).toBe(200);
  });

  it('conversa sem contato → troca persiste mas NÃO re-engaja (só socket)', async () => {
    convRow = { ...convRow!, contactId: null };
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/agent`)
      .set('x-test-auth', '1')
      .send({ agentId: AGENT_B });
    expect(res.status).toBe(200);
    expect(sendToQueueMock).toHaveBeenCalledTimes(1);
    expect(sendToQueueMock.mock.calls[0]?.[0]).toBe('hm.q.socket.relay');
  });

  it('fallback sem-dept: agente ativo é elegível mesmo sem vínculo de departamento', async () => {
    convRow = { ...convRow!, departmentId: null };
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/agent`)
      .set('x-test-auth', '1')
      .send({ agentId: AGENT_OUTSIDER });
    expect(res.status).toBe(200);
    expect(res.body.agentId).toBe(AGENT_OUTSIDER);
  });
});
