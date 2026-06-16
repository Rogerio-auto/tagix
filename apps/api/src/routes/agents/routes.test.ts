/**
 * Testes das rotas de agentes IA com foco em F34-S02 (config de departamentos).
 *
 * Estratégia: mocks de `@hm/db` e `../../middlewares/auth` — sem Docker/Postgres.
 * Montamos só o router de CRUD (`createAgentsCrudRouter`) porque o boundary deste
 * slot é o vínculo agente↔departamento. As outras sub-rotas (tools/models/...)
 * têm seus próprios testes.
 *
 * Cobre:
 *  - authz: sem sessão → 401; papel sem `agent.edit` → 403.
 *  - criar agente COM departamentos (persiste via `setAgentDepartments`).
 *  - trocar (replace-all) os departamentos via PATCH.
 *  - marcar um departamento como entrada (`isDefault`).
 *  - rejeitar 2 defaults no mesmo departamento (departamento repetido) → 400.
 *  - GET de detalhe inclui `departments`.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WORKSPACE_ID = 'ws-test';
const AGENT_ID = '00000000-0000-0000-0000-0000000000a1';
const DEPT_A = '00000000-0000-0000-0000-0000000000d1';
const DEPT_B = '00000000-0000-0000-0000-0000000000d2';
const DEPT_ARCHIVED = '00000000-0000-0000-0000-0000000000d9';

/** Departamentos ATIVOS visíveis ao tenant (assertDepartmentsValid usa isto). */
let activeDepartmentIds = new Set<string>([DEPT_A, DEPT_B]);

/** Estado in-memory dos vínculos do agente (o que `listDepartmentsForAgent` lê). */
let agentDepartments: Array<{ departmentId: string; isDefault: boolean }> = [];

const setAgentDepartmentsMock = vi.fn(
  async (
    _tx: unknown,
    _workspaceId: string,
    _agentId: string,
    items: Array<{ departmentId: string; isDefault: boolean }>,
  ) => {
    agentDepartments = items.map((i) => ({ ...i }));
  },
);

const listDepartmentsForAgentMock = vi.fn(async () => agentDepartments.map((d) => ({ ...d })));

// ─── Mock de @hm/db ───────────────────────────────────────────────────────────
//
// O `tx` fake imita o subset do query-builder do Drizzle que o crud.ts usa. Os
// objetos `schema.*` só precisam ser referências estáveis (são passados como
// argumentos opacos para o tx fake).

vi.mock('@hm/db', () => {
  const passthroughTable = new Proxy({}, { get: () => 'col' });
  return {
    schema: {
      agents: passthroughTable,
      agentTemplates: passthroughTable,
      agentTools: passthroughTable,
      tools: passthroughTable,
      departments: passthroughTable,
    },
    agentDepartmentsRepo: {
      setAgentDepartments: setAgentDepartmentsMock,
      listDepartmentsForAgent: listDepartmentsForAgentMock,
    },
    closeDb: vi.fn(),
  };
});

// ─── Mock de auth ─────────────────────────────────────────────────────────────

let mockRole = 'OWNER';

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers['x-test-auth'] !== '1') {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    (req as { auth?: unknown }).auth = { workspace: { id: WORKSPACE_ID } };
    next();
  },
  withRLS: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as { scoped?: unknown }).scoped = async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(makeTx());
    next();
  },
  requireRole:
    (perm: string) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      // `agent.edit` é OWNER/ADMIN. READONLY/AGENT/SUPERVISOR não editam agentes.
      const editors = new Set(['OWNER', 'ADMIN']);
      if (perm === 'agent.edit' && !editors.has(mockRole)) {
        res.status(403).json({ message: `Sem permissão: ${perm}` });
        return;
      }
      next();
    },
}));

// ─── Tx fake (subset do Drizzle usado pelo crud.ts) ───────────────────────────

function makeTx() {
  // INSERT de agente devolve a linha pública; INSERT de tools é no-op.
  const insertChain = {
    values: (_vals: unknown) => ({
      returning: (_cols: unknown) => [
        {
          id: AGENT_ID,
          workspaceId: WORKSPACE_ID,
          name: 'Agente',
          systemPrompt: 'p',
          status: 'active',
        },
      ],
      onConflictDoNothing: () => Promise.resolve(),
    }),
  };

  return {
    select: (cols: Record<string, unknown> | undefined) => {
      // assertDepartmentsValid faz `select({ id })` (1 coluna). O select do agente
      // usa PUBLIC_AGENT_COLUMNS (muitas colunas). Distinguimos pela cardinalidade.
      const isDeptProbe = Boolean(cols) && Object.keys(cols ?? {}).length === 1 && 'id' in cols!;
      const agentRow = {
        id: AGENT_ID,
        workspaceId: WORKSPACE_ID,
        name: 'Agente',
        systemPrompt: 'p',
        status: 'active',
      };
      return {
        from: () => ({
          where: () =>
            isDeptProbe
              ? [...activeDepartmentIds].map((id) => ({ id }))
              : { limit: (_n: number) => [agentRow] },
          orderBy: () => [agentRow],
          limit: (_n: number) => [agentRow],
        }),
      };
    },
    insert: (_table: unknown) => insertChain,
    update: (_table: unknown) => ({
      set: (_data: unknown) => ({
        where: () => ({
          returning: (_cols: unknown) => [
            {
              id: AGENT_ID,
              workspaceId: WORKSPACE_ID,
              name: 'Agente',
              systemPrompt: 'p',
              status: 'active',
            },
          ],
        }),
      }),
    }),
    delete: (_table: unknown) => ({ where: () => Promise.resolve() }),
  };
}

// ─── App de teste ─────────────────────────────────────────────────────────────

const { createAgentsCrudRouter } = await import('./crud');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(createAgentsCrudRouter());
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'OWNER';
  activeDepartmentIds = new Set<string>([DEPT_A, DEPT_B]);
  agentDepartments = [];
});

// ─── Authz ────────────────────────────────────────────────────────────────────

describe('autorização', () => {
  it('GET /api/agents sem sessão → 401', async () => {
    const res = await request(makeApp()).get('/api/agents');
    expect(res.status).toBe(401);
  });

  it('POST /api/agents sem sessão → 401', async () => {
    const res = await request(makeApp()).post('/api/agents').send({ name: 'x', systemPrompt: 'y' });
    expect(res.status).toBe(401);
  });

  it('PATCH /api/agents/:id sem sessão → 401', async () => {
    const res = await request(makeApp()).patch(`/api/agents/${AGENT_ID}`).send({ name: 'z' });
    expect(res.status).toBe(401);
  });

  it('POST /api/agents como READONLY → 403', async () => {
    mockRole = 'READONLY';
    const res = await request(makeApp())
      .post('/api/agents')
      .set('x-test-auth', '1')
      .send({ name: 'x', systemPrompt: 'y' });
    expect(res.status).toBe(403);
  });
});

// ─── Departamentos no agente (F34-S02) ────────────────────────────────────────

describe('F34-S02 — config de departamentos', () => {
  it('cria agente COM departamentos → persiste via setAgentDepartments e retorna departments', async () => {
    const res = await request(makeApp())
      .post('/api/agents')
      .set('x-test-auth', '1')
      .send({
        name: 'Vendas',
        systemPrompt: 'Você vende.',
        departments: [
          { departmentId: DEPT_A, isDefault: true },
          { departmentId: DEPT_B, isDefault: false },
        ],
      });

    expect(res.status).toBe(201);
    expect(setAgentDepartmentsMock).toHaveBeenCalledWith(
      expect.anything(),
      WORKSPACE_ID,
      AGENT_ID,
      [
        { departmentId: DEPT_A, isDefault: true },
        { departmentId: DEPT_B, isDefault: false },
      ],
    );
    expect(res.body.agent.departments).toEqual([
      { departmentId: DEPT_A, isDefault: true },
      { departmentId: DEPT_B, isDefault: false },
    ]);
  });

  it('cria agente SEM departamentos → não chama setAgentDepartments', async () => {
    const res = await request(makeApp())
      .post('/api/agents')
      .set('x-test-auth', '1')
      .send({ name: 'Solo', systemPrompt: 'Sozinho.' });

    expect(res.status).toBe(201);
    expect(setAgentDepartmentsMock).not.toHaveBeenCalled();
    expect(res.body.agent.departments).toEqual([]);
  });

  it('PATCH troca o conjunto de departamentos (replace-all)', async () => {
    const res = await request(makeApp())
      .patch(`/api/agents/${AGENT_ID}`)
      .set('x-test-auth', '1')
      .send({ departments: [{ departmentId: DEPT_B, isDefault: true }] });

    expect(res.status).toBe(200);
    expect(setAgentDepartmentsMock).toHaveBeenCalledWith(expect.anything(), WORKSPACE_ID, AGENT_ID, [
      { departmentId: DEPT_B, isDefault: true },
    ]);
    expect(res.body.agent.departments).toEqual([{ departmentId: DEPT_B, isDefault: true }]);
  });

  it('PATCH com departments: [] desvincula todos', async () => {
    agentDepartments = [{ departmentId: DEPT_A, isDefault: true }];
    const res = await request(makeApp())
      .patch(`/api/agents/${AGENT_ID}`)
      .set('x-test-auth', '1')
      .send({ departments: [] });

    expect(res.status).toBe(200);
    expect(setAgentDepartmentsMock).toHaveBeenCalledWith(
      expect.anything(),
      WORKSPACE_ID,
      AGENT_ID,
      [],
    );
    expect(res.body.agent.departments).toEqual([]);
  });

  it('PATCH sem o campo departments NÃO mexe nos vínculos', async () => {
    const res = await request(makeApp())
      .patch(`/api/agents/${AGENT_ID}`)
      .set('x-test-auth', '1')
      .send({ name: 'Renomeado' });

    expect(res.status).toBe(200);
    expect(setAgentDepartmentsMock).not.toHaveBeenCalled();
  });

  it('rejeita 2 entradas no MESMO departamento (departamento repetido) → 400', async () => {
    const res = await request(makeApp())
      .post('/api/agents')
      .set('x-test-auth', '1')
      .send({
        name: 'Dup',
        systemPrompt: 'p',
        departments: [
          { departmentId: DEPT_A, isDefault: true },
          { departmentId: DEPT_A, isDefault: false },
        ],
      });

    expect(res.status).toBe(400);
    expect(setAgentDepartmentsMock).not.toHaveBeenCalled();
  });

  it('rejeita departamento arquivado/inexistente → 400', async () => {
    const res = await request(makeApp())
      .post('/api/agents')
      .set('x-test-auth', '1')
      .send({
        name: 'Bad',
        systemPrompt: 'p',
        departments: [{ departmentId: DEPT_ARCHIVED, isDefault: false }],
      });

    expect(res.status).toBe(400);
    expect(setAgentDepartmentsMock).not.toHaveBeenCalled();
  });

  it('GET /api/agents/:id inclui departments', async () => {
    agentDepartments = [{ departmentId: DEPT_A, isDefault: true }];
    const res = await request(makeApp())
      .get(`/api/agents/${AGENT_ID}`)
      .set('x-test-auth', '1');

    expect(res.status).toBe(200);
    expect(listDepartmentsForAgentMock).toHaveBeenCalled();
    expect(res.body.agent.departments).toEqual([{ departmentId: DEPT_A, isDefault: true }]);
  });
});
