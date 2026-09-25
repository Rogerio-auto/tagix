/**
 * F70-S18 (L4) — campanhas recusam canal e agente de handoff de outro workspace.
 *
 * `campaigns.channel_id` / `ai_handoff_agent_id` têm FK, e a FK ignora RLS: sem a checagem
 * explícita, A criaria campanha disparando pelo canal de B (o builder usa esse canal para
 * abrir conversa de teste) ou entregando a resposta a um agente de B. A resposta é o 422
 * `invalid_reference` da F70-S11, idêntico para "é de outro workspace" e "não existe".
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
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
const { createCampaignsCrudRouter } = await import('./crud');

const app = express();
app.use(express.json());
app.use(createCampaignsCrudRouter());

let A: TenantFixture;
let B: TenantFixture;
let draftA = '';
let draftB = '';

async function seedDraft(t: TenantFixture): Promise<string> {
  const [row] = await getDb()
    .insert(schema.campaigns)
    .values({
      workspaceId: t.ws,
      channelId: t.channel,
      name: `Rascunho ${randomUUID().slice(0, 8)}`,
      type: 'broadcast',
      status: 'draft',
    })
    .returning({ id: schema.campaigns.id });
  if (!row) throw new Error('fixture: campanha');
  return row.id;
}

beforeAll(async () => {
  A = await seedTenant('A');
  B = await seedTenant('B');
  draftA = await seedDraft(A);
  draftB = await seedDraft(B);
});

afterAll(async () => {
  const ids = [A?.ws, B?.ws].filter((id): id is string => typeof id === 'string');
  if (ids.length > 0) {
    await getDb().delete(schema.campaigns).where(inArray(schema.campaigns.workspaceId, ids));
  }
  await dropTenants(A, B);
  await closeDb();
});

beforeEach(() => {
  actAs(A);
});

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

async function campaignsNamed(name: string): Promise<unknown[]> {
  return getDb()
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.workspaceId, A.ws), eq(schema.campaigns.name, name)));
}

describe('POST /api/campaigns (F70-S18)', () => {
  it('channelId de B → 422 igual a inexistente, e nada é criado', async () => {
    const name = `Cross canal ${randomUUID().slice(0, 8)}`;
    await expectSameRejection(
      (channelId) => request(app).post('/api/campaigns').send({ channelId, name, mode: 'single' }),
      B.channel,
      'channelId',
    );
    expect(await campaignsNamed(name)).toEqual([]);
  });

  it('aiHandoffAgentId de B → 422 igual a inexistente, e nada é criado', async () => {
    const name = `Cross agente ${randomUUID().slice(0, 8)}`;
    await expectSameRejection(
      (aiHandoffAgentId) =>
        request(app)
          .post('/api/campaigns')
          .send({ channelId: A.channel, name, mode: 'single', aiHandoffAgentId }),
      B.agent,
      'aiHandoffAgentId',
    );
    expect(await campaignsNamed(name)).toEqual([]);
  });

  it('canal e agente próprios → 201', async () => {
    const res = await request(app).post('/api/campaigns').send({
      channelId: A.channel,
      name: `Ok ${randomUUID().slice(0, 8)}`,
      mode: 'single',
      aiHandoffAgentId: A.agent,
    });
    expect(res.status).toBe(201);
    expect(res.body.campaign.aiHandoffAgentId).toBe(A.agent);
  });
});

describe('PUT /api/campaigns/:id (F70-S18)', () => {
  it('aiHandoffAgentId de B → 422 igual a inexistente, sem alterar a campanha', async () => {
    await expectSameRejection(
      (aiHandoffAgentId) =>
        request(app).put(`/api/campaigns/${draftA}`).send({ aiHandoffAgentId }),
      B.agent,
      'aiHandoffAgentId',
    );
    const [row] = await getDb()
      .select({ agent: schema.campaigns.aiHandoffAgentId })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, draftA));
    expect(row?.agent).toBeNull();
  });

  it('campanha de B → 409 de sempre, antes de olhar o payload', async () => {
    const res = await request(app).put(`/api/campaigns/${draftB}`).send({ aiHandoffAgentId: B.agent });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_editable');
  });

  it('agente próprio → 200; null limpa', async () => {
    const set = await request(app).put(`/api/campaigns/${draftA}`).send({ aiHandoffAgentId: A.agent });
    expect(set.status).toBe(200);
    expect(set.body.campaign.aiHandoffAgentId).toBe(A.agent);
    const clear = await request(app).put(`/api/campaigns/${draftA}`).send({ aiHandoffAgentId: null });
    expect(clear.status).toBe(200);
    expect(clear.body.campaign.aiHandoffAgentId).toBeNull();
  });
});
