/**
 * F70-S18 (L4) — rotas de org recusam departamento/time de outro workspace.
 *
 * A FK `teams.department_id` e `member_visibility_overrides.department_id` ignora RLS, e
 * `sla_rules.scope_id` nem FK tem: sem a checagem explícita, o workspace A penduraria dado
 * em linha de B. A resposta é o 422 `invalid_reference` da F70-S11, IDÊNTICO para "é de
 * outro workspace" e "não existe" (sem oráculo de existência de UUID).
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
const { createOrgRouter } = await import('./org');

const app = express();
app.use(express.json());
app.use(createOrgRouter());

let A: TenantFixture;
let B: TenantFixture;
let deptA = '';
let deptB = '';

async function seedDepartment(workspaceId: string, label: string): Promise<string> {
  const [row] = await getDb()
    .insert(schema.departments)
    .values({ workspaceId, name: `Dept ${label} ${randomUUID().slice(0, 8)}` })
    .returning({ id: schema.departments.id });
  if (!row) throw new Error('fixture: departamento');
  return row.id;
}

beforeAll(async () => {
  A = await seedTenant('A');
  B = await seedTenant('B');
  deptA = await seedDepartment(A.ws, 'A');
  deptB = await seedDepartment(B.ws, 'B');
});

afterAll(async () => {
  await dropTenants(A, B);
  await closeDb();
});

beforeEach(() => {
  actAs(A);
});

/** Manda o mesmo pedido com o id de B e com um UUID inexistente; os dois têm de ser iguais. */
async function expectSameRejection(
  send: (id: string) => Promise<request.Response>,
  foreignId: string,
  field: string,
): Promise<void> {
  const foreign = await send(foreignId);
  expect(foreign.status).toBe(422);
  expect(foreign.body.error).toBe('invalid_reference');
  expect(foreign.body.fields).toEqual([field]);
  expect(JSON.stringify(foreign.body)).not.toContain(foreignId);
  const ghost = await send(ghostId());
  expect(ghost.status).toBe(422);
  expect(ghost.body).toEqual(foreign.body);
}

describe('POST /api/teams — departmentId (F70-S18)', () => {
  it('departamento de B → 422 igual a inexistente, e o time não é criado', async () => {
    const name = `Time cross ${randomUUID().slice(0, 8)}`;
    await expectSameRejection(
      (departmentId) => request(app).post('/api/teams').send({ name, departmentId }),
      deptB,
      'departmentId',
    );
    const rows = await getDb()
      .select({ id: schema.teams.id })
      .from(schema.teams)
      .where(and(eq(schema.teams.workspaceId, A.ws), eq(schema.teams.name, name)));
    expect(rows).toEqual([]);
  });

  it('departamento próprio → 201', async () => {
    const res = await request(app)
      .post('/api/teams')
      .send({ name: `Time ok ${randomUUID().slice(0, 8)}`, departmentId: deptA });
    expect(res.status).toBe(201);
    expect(res.body.team.departmentId).toBe(deptA);
  });
});

describe('PATCH /api/teams/:id — departmentId (F70-S18)', () => {
  it('departamento de B → 422 igual a inexistente, sem alterar o time', async () => {
    await expectSameRejection(
      (departmentId) => request(app).patch(`/api/teams/${A.team}`).send({ departmentId }),
      deptB,
      'departmentId',
    );
    const [team] = await getDb()
      .select({ departmentId: schema.teams.departmentId })
      .from(schema.teams)
      .where(eq(schema.teams.id, A.team));
    expect(team?.departmentId).not.toBe(deptB);
  });

  it('time de B → 404 antes de olhar o payload', async () => {
    const res = await request(app).patch(`/api/teams/${B.team}`).send({ departmentId: deptB });
    expect(res.status).toBe(404);
  });

  it('departamento próprio → 200', async () => {
    const res = await request(app).patch(`/api/teams/${A.team}`).send({ departmentId: deptA });
    expect(res.status).toBe(200);
    expect(res.body.team.departmentId).toBe(deptA);
  });
});

describe('PUT /api/org/members/:id/visibility-overrides — departmentIds (F70-S18)', () => {
  it('um departamento de B no conjunto → 422 igual a inexistente, nada gravado', async () => {
    await expectSameRejection(
      (departmentId) =>
        request(app)
          .put(`/api/org/members/${A.otherMember}/visibility-overrides`)
          .send({ departmentIds: [deptA, departmentId] }),
      deptB,
      'departmentIds',
    );
    const rows = await getDb()
      .select()
      .from(schema.memberVisibilityOverrides)
      .where(eq(schema.memberVisibilityOverrides.memberId, A.otherMember));
    expect(rows).toEqual([]);
  });

  it('membro de B → 404 antes de olhar o payload', async () => {
    const res = await request(app)
      .put(`/api/org/members/${B.otherMember}/visibility-overrides`)
      .send({ departmentIds: [deptB] });
    expect(res.status).toBe(404);
  });

  it('departamentos próprios → 200 (UUID em maiúsculas deduplica)', async () => {
    const res = await request(app)
      .put(`/api/org/members/${A.otherMember}/visibility-overrides`)
      .send({ departmentIds: [deptA, deptA.toUpperCase()] });
    expect(res.status).toBe(200);
    expect(res.body.departmentIds).toEqual([deptA]);
  });
});

describe('PUT /api/sla — scopeId (F70-S18)', () => {
  it('departamento de B como escopo → 422 igual a inexistente', async () => {
    await expectSameRejection(
      (scopeId) =>
        request(app).put('/api/sla').send({ scopeType: 'department', scopeId, firstResponseSecs: 60 }),
      deptB,
      'scopeId',
    );
  });

  it('time de B como escopo → 422 igual a inexistente', async () => {
    await expectSameRejection(
      (scopeId) =>
        request(app).put('/api/sla').send({ scopeType: 'team', scopeId, firstResponseSecs: 60 }),
      B.team,
      'scopeId',
    );
  });

  it('nenhuma regra de A aponta para escopo de B', async () => {
    const rows = await getDb()
      .select({ scopeId: schema.slaRules.scopeId })
      .from(schema.slaRules)
      .where(eq(schema.slaRules.workspaceId, A.ws));
    expect(rows.map((r) => r.scopeId)).not.toContain(deptB);
    expect(rows.map((r) => r.scopeId)).not.toContain(B.team);
  });

  it('escopo próprio → 200', async () => {
    const dept = await request(app)
      .put('/api/sla')
      .send({ scopeType: 'department', scopeId: deptA, firstResponseSecs: 60 });
    expect(dept.status).toBe(200);
    const team = await request(app)
      .put('/api/sla')
      .send({ scopeType: 'team', scopeId: A.team, resolutionSecs: 3600 });
    expect(team.status).toBe(200);
  });
});
