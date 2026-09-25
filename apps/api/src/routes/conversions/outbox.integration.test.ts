/**
 * F70-S17 — `POST /api/conversions` grava `conversion.registered` na outbox, na
 * transação do registro (Postgres dev, RLS real).
 *
 *  - commit → uma linha com o `event_id` canônico `<conversionId>:registered`;
 *  - dedup do mesmo dia (409) → nenhuma linha nova;
 *  - rollback forçado depois de todo o trabalho, antes do COMMIT → nem a conversão
 *    nem o evento ficam.
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type * as Db from '@hm/db';

const rollback = vi.hoisted(() => ({ armed: false }));
vi.mock('@hm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>();
  const { armableWithWorkspace } = await import('../deals/__tests__/forced-rollback');
  return { ...actual, withWorkspace: armableWithWorkspace(actual.withWorkspace, rollback) };
});
vi.mock('../../middlewares/auth', async () =>
  (await import('../deals/__tests__/two-workspaces')).authMiddlewareMock(),
);

const { closeDb, getDb, schema } = await import('@hm/db');
const { actAs, dropTenants, seedTenant } = await import('../deals/__tests__/two-workspaces');
const { outboxEventsNamed } = await import('../deals/__tests__/outbox');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { createConversionEventsRouter } = await import('./events');

const app = express();
app.use(express.json());
app.use(createConversionEventsRouter());

let A: TenantFixture;

beforeAll(async () => {
  A = await seedTenant('A');
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

async function conversionsOf(workspaceId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: schema.conversionEvents.id })
    .from(schema.conversionEvents)
    .where(eq(schema.conversionEvents.workspaceId, workspaceId));
  return rows.length;
}

describe('POST /api/conversions → conversion.registered na outbox (F70-S17)', () => {
  // Ordem importa: o rollback roda antes do commit (o dedup é por contato+tipo+dia).
  it('rollback: nem a conversão nem o evento ficam', async () => {
    rollback.armed = true;
    const res = await request(app)
      .post('/api/conversions')
      .send({ conversionTypeId: A.conversionType, contactId: A.contact });
    expect(res.status).toBe(500);
    rollback.armed = false;

    expect(await conversionsOf(A.ws)).toBe(0);
    expect(await outboxEventsNamed(A.ws, 'conversion.registered')).toHaveLength(0);
  });

  it('commit: uma linha com o event_id canônico; o dedup do dia não grava outra', async () => {
    const res = await request(app)
      .post('/api/conversions')
      .send({ conversionTypeId: A.conversionType, contactId: A.contact, dealId: A.deal });
    expect(res.status).toBe(201);
    const conversionId: string = res.body.conversion.id;

    const rows = await outboxEventsNamed(A.ws, 'conversion.registered');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'event',
      eventId: `${conversionId}:registered`,
      exchange: 'hm.events',
      routingKey: 'domain.conversion.registered',
      workspaceId: A.ws,
    });
    expect(rows[0]?.data).toMatchObject({
      conversionId,
      contactId: A.contact,
      dealId: A.deal,
      source: 'manual',
    });

    const dup = await request(app)
      .post('/api/conversions')
      .send({ conversionTypeId: A.conversionType, contactId: A.contact });
    expect(dup.status).toBe(409);
    expect(await outboxEventsNamed(A.ws, 'conversion.registered')).toHaveLength(1);
  });
});
