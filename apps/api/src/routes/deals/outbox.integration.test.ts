/**
 * F70-S17 — deals gravam os eventos de domínio na outbox, na transação do dado
 * (Postgres dev, RLS real, `hm_app`).
 *
 * Por produtor:
 *  - commit → exatamente uma linha com o `event_id` canônico, destino `hm.events`;
 *  - rollback forçado depois de TODO o trabalho (dado + outbox), antes do COMMIT →
 *    nenhuma linha. Prova que o evento é da mesma transação do dado.
 *
 * Produtores: `POST /api/deals` (deal.created), `POST /api/deals/:id/move-stage`
 * (deal.stage_changed), `POST /api/deals/:id/close-won|close-lost` (deal.won/lost).
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type * as Db from '@hm/db';

const rollback = vi.hoisted(() => ({ armed: false }));
vi.mock('@hm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>();
  const { armableWithWorkspace } = await import('./__tests__/forced-rollback');
  return { ...actual, withWorkspace: armableWithWorkspace(actual.withWorkspace, rollback) };
});
vi.mock('../../middlewares/auth', async () =>
  (await import('./__tests__/two-workspaces')).authMiddlewareMock(),
);

const { closeDb, getDb, schema } = await import('@hm/db');
const { actAs, dropTenants, seedTenant } = await import('./__tests__/two-workspaces');
const { outboxEventsNamed } = await import('./__tests__/outbox');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { createDealsCrudRouter } = await import('./crud');

const app = express();
app.use(express.json());
app.use(createDealsCrudRouter());

let A: TenantFixture;
/** Segundo estágio do pipeline de A (destino dos movimentos). */
let stage2 = '';

beforeAll(async () => {
  A = await seedTenant('A');
  const [row] = await getDb()
    .insert(schema.stages)
    .values({ workspaceId: A.ws, pipelineId: A.pipeline, name: 'Proposta', position: 1 })
    .returning({ id: schema.stages.id });
  if (!row) throw new Error('fixture: estágio 2 não criado');
  stage2 = row.id;
});

afterAll(async () => {
  rollback.armed = false;
  await dropTenants(A);
  await closeDb();
});

beforeEach(() => {
  rollback.armed = false;
  actAs(A);
});

/** Deal novo no estágio 1 de A, gravado fora da rota (sem evento). */
async function freshDeal(): Promise<string> {
  const [row] = await getDb()
    .insert(schema.deals)
    .values({
      workspaceId: A.ws,
      pipelineId: A.pipeline,
      stageId: A.stage,
      contactId: A.contact,
      title: 'Deal F70-S17',
    })
    .returning({ id: schema.deals.id });
  if (!row) throw new Error('fixture: deal não criado');
  return row.id;
}

async function dealRow(id: string) {
  const [row] = await getDb().select().from(schema.deals).where(eq(schema.deals.id, id));
  return row;
}

describe('POST /api/deals → deal.created na outbox (F70-S17)', () => {
  it('commit: uma linha com o event_id canônico', async () => {
    const res = await request(app)
      .post('/api/deals')
      .send({ pipelineId: A.pipeline, stageId: A.stage, contactId: A.contact, title: 'Novo' });
    expect(res.status).toBe(201);
    const dealId: string = res.body.deal.id;

    const rows = (await outboxEventsNamed(A.ws, 'deal.created')).filter(
      (r) => r.data['dealId'] === dealId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'event',
      eventId: `${dealId}:created`,
      exchange: 'hm.events',
      routingKey: 'domain.deal.created',
      workspaceId: A.ws,
    });
  });

  it('rollback: nem o deal nem o evento ficam', async () => {
    const before = (await outboxEventsNamed(A.ws, 'deal.created')).length;
    rollback.armed = true;
    const title = `Rollback ${Date.now()}`;
    const res = await request(app)
      .post('/api/deals')
      .send({ pipelineId: A.pipeline, stageId: A.stage, contactId: A.contact, title });
    expect(res.status).toBe(500);
    rollback.armed = false;

    const deals = await getDb()
      .select({ id: schema.deals.id })
      .from(schema.deals)
      .where(eq(schema.deals.title, title));
    expect(deals).toHaveLength(0);
    expect(await outboxEventsNamed(A.ws, 'deal.created')).toHaveLength(before);
  });
});

describe('POST /api/deals/:id/move-stage → deal.stage_changed na outbox (F70-S17)', () => {
  it('commit: uma linha com a ocorrência própria do movimento', async () => {
    const dealId = await freshDeal();
    const res = await request(app)
      .post(`/api/deals/${dealId}/move-stage`)
      .send({ stageId: stage2 });
    expect(res.status).toBe(200);

    const rows = (await outboxEventsNamed(A.ws, 'deal.stage_changed')).filter(
      (r) => r.data['dealId'] === dealId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventId).toMatch(
      new RegExp(
        `^${dealId}:stage_changed:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
      ),
    );
    expect(rows[0]).toMatchObject({ routingKey: 'domain.deal.stage_changed', kind: 'event' });
    expect(rows[0]?.data).toMatchObject({
      fromStageId: A.stage,
      toStageId: stage2,
      actorType: 'member',
    });
  });

  it('mover para o mesmo estágio não grava evento', async () => {
    const dealId = await freshDeal();
    const res = await request(app)
      .post(`/api/deals/${dealId}/move-stage`)
      .send({ stageId: A.stage });
    expect(res.status).toBe(200);
    const rows = (await outboxEventsNamed(A.ws, 'deal.stage_changed')).filter(
      (r) => r.data['dealId'] === dealId,
    );
    expect(rows).toHaveLength(0);
  });

  it('rollback: o deal não sai do estágio e nada fica na outbox', async () => {
    const dealId = await freshDeal();
    rollback.armed = true;
    const res = await request(app)
      .post(`/api/deals/${dealId}/move-stage`)
      .send({ stageId: stage2 });
    expect(res.status).toBe(500);
    rollback.armed = false;

    expect((await dealRow(dealId))?.stageId).toBe(A.stage);
    const rows = (await outboxEventsNamed(A.ws, 'deal.stage_changed')).filter(
      (r) => r.data['dealId'] === dealId,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('POST /api/deals/:id/close-won|close-lost → deal.won/lost na outbox (F70-S17)', () => {
  it('commit (ganho): uma linha cuja ocorrência é o closed_at gravado', async () => {
    const dealId = await freshDeal();
    const res = await request(app).post(`/api/deals/${dealId}/close-won`).send({});
    expect(res.status).toBe(200);
    const closedAt = (await dealRow(dealId))?.closedAt;
    expect(closedAt).toBeInstanceOf(Date);

    const rows = (await outboxEventsNamed(A.ws, 'deal.won')).filter(
      (r) => r.data['dealId'] === dealId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventId: `${dealId}:won:${closedAt?.getTime()}`,
      routingKey: 'domain.deal.won',
    });
  });

  it('commit (perdido): uma linha deal.lost', async () => {
    const dealId = await freshDeal();
    const res = await request(app).post(`/api/deals/${dealId}/close-lost`).send({ reason: 'x' });
    expect(res.status).toBe(200);
    const rows = (await outboxEventsNamed(A.ws, 'deal.lost')).filter(
      (r) => r.data['dealId'] === dealId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventId).toMatch(new RegExp(`^${dealId}:lost:\\d+$`));
  });

  it('rollback: o deal segue aberto e nada fica na outbox', async () => {
    const dealId = await freshDeal();
    rollback.armed = true;
    const res = await request(app).post(`/api/deals/${dealId}/close-won`).send({});
    expect(res.status).toBe(500);
    rollback.armed = false;

    expect((await dealRow(dealId))?.closedAt).toBeNull();
    const rows = (await outboxEventsNamed(A.ws, 'deal.won')).filter(
      (r) => r.data['dealId'] === dealId,
    );
    expect(rows).toHaveLength(0);
  });
});
