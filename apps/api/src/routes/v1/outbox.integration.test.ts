/**
 * F70-S17 — API pública v1 grava os eventos de domínio na outbox, na transação do
 * dado (Postgres dev, RLS real):
 *  - `POST /api/v1/deals/:id/move` → `deal.stage_changed` (autor `api`);
 *  - `POST /api/v1/conversions` → `conversion.registered`.
 *
 * Por produtor: commit → uma linha com o `event_id` canônico; rollback forçado depois
 * de todo o trabalho, antes do COMMIT → nenhuma linha.
 *
 * A chave de API é mockada (sem Redis do rate limit): o tenant vem de
 * `req.apiAuth.workspaceId`, exatamente o que o middleware real injeta.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type * as Db from '@hm/db';

const { keyWorkspace, rollback } = vi.hoisted(() => ({
  keyWorkspace: { id: '' },
  rollback: { armed: false },
}));
vi.mock('@hm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>();
  const { armableWithWorkspace } = await import('../deals/__tests__/forced-rollback');
  return { ...actual, withWorkspace: armableWithWorkspace(actual.withWorkspace, rollback) };
});
vi.mock('../../middlewares/api-key', () => ({
  requireApiKey: (req: Request, _res: Response, next: NextFunction) => {
    req.apiAuth = { workspaceId: keyWorkspace.id } as Request['apiAuth'];
    next();
  },
  requireScope: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  closeApiKeyRateLimiter: async () => {},
}));

const { closeDb, getDb, schema } = await import('@hm/db');
const { dropTenants, seedTenant } = await import('../deals/__tests__/two-workspaces');
const { outboxEventsNamed } = await import('../deals/__tests__/outbox');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { createV1Router } = await import('./index');

const app = express();
app.use(express.json());
app.use(createV1Router());

let A: TenantFixture;
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
  keyWorkspace.id = A.ws;
});

async function freshDeal(): Promise<string> {
  const [row] = await getDb()
    .insert(schema.deals)
    .values({
      workspaceId: A.ws,
      pipelineId: A.pipeline,
      stageId: A.stage,
      contactId: A.contact,
      title: 'Deal v1 F70-S17',
    })
    .returning({ id: schema.deals.id });
  if (!row) throw new Error('fixture: deal não criado');
  return row.id;
}

async function stageChangedOf(dealId: string) {
  return (await outboxEventsNamed(A.ws, 'deal.stage_changed')).filter(
    (r) => r.data['dealId'] === dealId,
  );
}

describe('POST /api/v1/deals/:id/move → deal.stage_changed na outbox (F70-S17)', () => {
  it('commit: uma linha com a ocorrência do movimento e autor api', async () => {
    const dealId = await freshDeal();
    const res = await request(app).post(`/api/v1/deals/${dealId}/move`).send({ stageId: stage2 });
    expect(res.status).toBe(200);

    const rows = await stageChangedOf(dealId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventId).toMatch(
      new RegExp(
        `^${dealId}:stage_changed:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
      ),
    );
    expect(rows[0]).toMatchObject({ kind: 'event', routingKey: 'domain.deal.stage_changed' });
    expect(rows[0]?.data).toMatchObject({
      fromStageId: A.stage,
      toStageId: stage2,
      actorType: 'api',
    });
  });

  it('mesmo estágio é no-op: nenhuma linha', async () => {
    const dealId = await freshDeal();
    const res = await request(app).post(`/api/v1/deals/${dealId}/move`).send({ stageId: A.stage });
    expect(res.status).toBe(200);
    expect(await stageChangedOf(dealId)).toHaveLength(0);
  });

  it('rollback: o deal não se move e nada fica na outbox', async () => {
    const dealId = await freshDeal();
    rollback.armed = true;
    const res = await request(app).post(`/api/v1/deals/${dealId}/move`).send({ stageId: stage2 });
    expect(res.status).toBe(500);
    rollback.armed = false;

    const [deal] = await getDb()
      .select({ stageId: schema.deals.stageId })
      .from(schema.deals)
      .where(eq(schema.deals.id, dealId));
    expect(deal?.stageId).toBe(A.stage);
    expect(await stageChangedOf(dealId)).toHaveLength(0);
  });
});

describe('POST /api/v1/conversions → conversion.registered na outbox (F70-S17)', () => {
  // Ordem importa: o rollback roda antes do commit (o dedup é por contato+tipo+dia).
  it('rollback: nem a conversão nem o evento ficam', async () => {
    rollback.armed = true;
    const res = await request(app)
      .post('/api/v1/conversions')
      .send({ conversionTypeKey: A.conversionTypeKey, contactId: A.contact });
    expect(res.status).toBe(500);
    rollback.armed = false;

    const rows = await getDb()
      .select({ id: schema.conversionEvents.id })
      .from(schema.conversionEvents)
      .where(eq(schema.conversionEvents.workspaceId, A.ws));
    expect(rows).toHaveLength(0);
    expect(await outboxEventsNamed(A.ws, 'conversion.registered')).toHaveLength(0);
  });

  it('commit: uma linha com o event_id canônico; o dedup do dia não grava outra', async () => {
    const res = await request(app)
      .post('/api/v1/conversions')
      .send({ conversionTypeKey: A.conversionTypeKey, contactId: A.contact });
    expect(res.status).toBe(201);
    const conversionId: string = res.body.conversion.id;

    const rows = await outboxEventsNamed(A.ws, 'conversion.registered');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventId: `${conversionId}:registered`,
      exchange: 'hm.events',
      routingKey: 'domain.conversion.registered',
    });
    expect(rows[0]?.data).toMatchObject({ conversionId, source: 'api' });

    const dup = await request(app)
      .post('/api/v1/conversions')
      .send({ conversionTypeKey: A.conversionTypeKey, contactId: A.contact });
    expect(dup.status).toBe(200);
    expect(dup.body.status).toBe('deduped');
    expect(await outboxEventsNamed(A.ws, 'conversion.registered')).toHaveLength(1);
  });
});
