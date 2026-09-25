/**
 * F70-S11 — `POST /api/flows/:id/trigger` recusa conversa/contato de outro workspace
 * antes de chamar o engine (a execução gravaria os ids; a FK ignora RLS).
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@hm/db';

vi.mock('../../middlewares/auth', async () =>
  (await import('../deals/__tests__/two-workspaces')).authMiddlewareMock(),
);
const { triggerFlow } = vi.hoisted(() => ({
  triggerFlow: vi.fn(async () => ({ executionId: '00000000-0000-4000-8000-000000000001' })),
}));
vi.mock('./engine', () => ({ flowEngine: { triggerFlow } }));

const { actAs, dropTenants, ghostId, seedTenant } =
  await import('../deals/__tests__/two-workspaces');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { createFlowsCrudRouter } = await import('./crud');

const app = express();
app.use(express.json());
app.use(createFlowsCrudRouter());

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

beforeEach(() => {
  triggerFlow.mockClear();
  actAs(A);
});

describe('POST /api/flows/:id/trigger (F70-S11)', () => {
  for (const field of ['conversationId', 'contactId'] as const) {
    it(`${field} de B → 422, igual a inexistente, sem disparar`, async () => {
      const foreign = field === 'conversationId' ? B.conversation : B.contact;
      const res = await request(app)
        .post(`/api/flows/${A.flow}/trigger`)
        .send({ [field]: foreign });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('invalid_reference');
      expect(res.body.fields).toEqual([field]);

      const ghost = await request(app)
        .post(`/api/flows/${A.flow}/trigger`)
        .send({ [field]: ghostId() });
      expect(ghost.body).toEqual(res.body);
      expect(triggerFlow).not.toHaveBeenCalled();
    });
  }

  it('flow de B → 404', async () => {
    const res = await request(app).post(`/api/flows/${B.flow}/trigger`).send({});
    expect(res.status).toBe(404);
  });

  it('caminho feliz com conversa e contato próprios → 202', async () => {
    const res = await request(app)
      .post(`/api/flows/${A.flow}/trigger`)
      .send({ conversationId: A.conversation, contactId: A.contact });
    expect(res.status).toBe(202);
    expect(triggerFlow).toHaveBeenCalledTimes(1);
  });
});
