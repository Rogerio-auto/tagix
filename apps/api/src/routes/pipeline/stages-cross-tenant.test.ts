/**
 * F70-S11 — `POST /api/pipelines/:pipelineId/stages` com pipeline de outro workspace.
 *
 * Antes: a FK aceitava o pipeline de B e `stages_pipeline_position_uq` (global) deixava
 * A ocupar posições no funil de B (DoS). Agora: 404 idêntico ao de um id inexistente,
 * nada gravado, e B segue usando a posição. Posição repetida no próprio pipeline → 409.
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
const { createStagesRouter } = await import('./stages');

const app = express();
app.use(express.json());
app.use(createStagesRouter());

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

async function stagesOf(pipelineId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: schema.stages.id })
    .from(schema.stages)
    .where(eq(schema.stages.pipelineId, pipelineId));
  return rows.length;
}

describe('POST /api/pipelines/:pipelineId/stages (F70-S11)', () => {
  it('pipeline de B → 404 igual a inexistente, sem ocupar posição no funil de B', async () => {
    const res = await request(app)
      .post(`/api/pipelines/${B.pipeline}/stages`)
      .send({ name: 'Invasor', position: 1 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'pipeline_not_found' });

    const ghost = await request(app)
      .post(`/api/pipelines/${ghostId()}/stages`)
      .send({ name: 'Invasor', position: 1 });
    expect(ghost.status).toBe(404);
    expect(ghost.body).toEqual(res.body);

    const malformed = await request(app)
      .post('/api/pipelines/nao-e-uuid/stages')
      .send({ name: 'Invasor', position: 1 });
    expect(malformed.status).toBe(404);
    expect(malformed.body).toEqual(res.body);

    expect(await stagesOf(B.pipeline)).toBe(1);

    // B continua usando a posição 1 do próprio funil.
    actAs(B);
    const own = await request(app)
      .post(`/api/pipelines/${B.pipeline}/stages`)
      .send({ name: 'Proposta', position: 1 });
    expect(own.status).toBe(201);
    expect(own.body.stage.workspaceId).toBe(B.ws);
  });

  it('caminho feliz no próprio pipeline → 201; posição repetida → 409', async () => {
    const res = await request(app)
      .post(`/api/pipelines/${A.pipeline}/stages`)
      .send({ name: 'Qualificado', position: 5 });
    expect(res.status).toBe(201);
    expect(res.body.stage.pipelineId).toBe(A.pipeline);

    const dup = await request(app)
      .post(`/api/pipelines/${A.pipeline}/stages`)
      .send({ name: 'Outro', position: 5 });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('stage_position_taken');
  });

  it('PUT com posição já ocupada no pipeline → 409 (não 500)', async () => {
    const res = await request(app).put(`/api/stages/${A.stage}`).send({ position: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('stage_position_taken');
  });
});
