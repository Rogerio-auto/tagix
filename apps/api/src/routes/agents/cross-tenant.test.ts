/**
 * F70-S18 (L4) — vínculo agente↔departamento recusa departamento de outro workspace.
 *
 * Antes a checagem dependia só da RLS da leitura e respondia 400 com texto próprio. Agora
 * passa por `requireRefsInWorkspace` (filtro explícito por workspace) e responde o 422
 * `invalid_reference` da F70-S11, idêntico para "é de outro workspace" e "não existe".
 * Departamento ARQUIVADO do próprio workspace continua 400 (não vaza nada de outro tenant).
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';

vi.mock('../../middlewares/auth', async () =>
  (await import('../deals/__tests__/two-workspaces')).authMiddlewareMock(),
);

const { actAs, dropTenants, ghostId, seedTenant } =
  await import('../deals/__tests__/two-workspaces');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { createAgentsCrudRouter } = await import('./crud');

const app = express();
app.use(express.json());
app.use(createAgentsCrudRouter());

let A: TenantFixture;
let B: TenantFixture;
let deptA = '';
let archivedA = '';
let deptB = '';

async function seedDepartment(
  workspaceId: string,
  isActive: 'active' | 'archived' = 'active',
): Promise<string> {
  const [row] = await getDb()
    .insert(schema.departments)
    .values({ workspaceId, name: `Dept ${randomUUID().slice(0, 8)}`, isActive })
    .returning({ id: schema.departments.id });
  if (!row) throw new Error('fixture: departamento');
  return row.id;
}

beforeAll(async () => {
  A = await seedTenant('A');
  B = await seedTenant('B');
  deptA = await seedDepartment(A.ws);
  archivedA = await seedDepartment(A.ws, 'archived');
  deptB = await seedDepartment(B.ws);
});

afterAll(async () => {
  await dropTenants(A, B);
  await closeDb();
});

beforeEach(() => {
  actAs(A);
});

async function expectSameRejection(
  send: (id: string) => Promise<request.Response>,
  foreignId: string,
): Promise<void> {
  const foreign = await send(foreignId);
  expect(foreign.status).toBe(422);
  expect(foreign.body.error).toBe('invalid_reference');
  expect(foreign.body.fields).toEqual(['departments']);
  expect(JSON.stringify(foreign.body)).not.toContain(foreignId);
  const ghost = await send(ghostId());
  expect(ghost.status).toBe(422);
  expect(ghost.body).toEqual(foreign.body);
}

const newAgent = (name: string, departmentId: string) => ({
  name,
  systemPrompt: 'Você atende clientes.',
  departments: [{ departmentId, isDefault: false }],
});

describe('POST /api/agents — departments (F70-S18)', () => {
  it('departamento de B → 422 igual a inexistente, e o agente não é criado', async () => {
    const name = `Agente cross ${randomUUID().slice(0, 8)}`;
    await expectSameRejection(
      (departmentId) => request(app).post('/api/agents').send(newAgent(name, departmentId)),
      deptB,
    );
    const rows = await getDb()
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(and(eq(schema.agents.workspaceId, A.ws), eq(schema.agents.name, name)));
    expect(rows).toEqual([]);
  });

  it('departamento arquivado do próprio workspace → 400', async () => {
    const res = await request(app)
      .post('/api/agents')
      .send(newAgent(`Agente arq ${randomUUID().slice(0, 8)}`, archivedA));
    expect(res.status).toBe(400);
  });

  it('departamento próprio e ativo → 201', async () => {
    const res = await request(app)
      .post('/api/agents')
      .send(newAgent(`Agente ok ${randomUUID().slice(0, 8)}`, deptA));
    expect(res.status).toBe(201);
    expect(res.body.agent.departments.map((d: { departmentId: string }) => d.departmentId)).toEqual([
      deptA,
    ]);
  });
});

describe('PATCH /api/agents/:id — departments (F70-S18)', () => {
  it('departamento de B → 422 igual a inexistente, vínculos e edição revertidos', async () => {
    const name = `Renomeado ${randomUUID().slice(0, 8)}`;
    await expectSameRejection(
      (departmentId) =>
        request(app)
          .patch(`/api/agents/${A.agent}`)
          .send({ name, departments: [{ departmentId, isDefault: true }] }),
      deptB,
    );
    const links = await getDb()
      .select()
      .from(schema.agentDepartments)
      .where(eq(schema.agentDepartments.agentId, A.agent));
    expect(links).toEqual([]);
    const [agent] = await getDb()
      .select({ name: schema.agents.name })
      .from(schema.agents)
      .where(eq(schema.agents.id, A.agent));
    expect(agent?.name).not.toBe(name);
  });

  it('agente de B → 404 antes de olhar o payload', async () => {
    const res = await request(app)
      .patch(`/api/agents/${B.agent}`)
      .send({ departments: [{ departmentId: deptB, isDefault: false }] });
    expect(res.status).toBe(404);
  });
});
