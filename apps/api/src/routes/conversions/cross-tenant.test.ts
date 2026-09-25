/**
 * F70-S11 — `POST /api/conversions` recusa contato, conversa, deal e canal de outro
 * workspace (a trava mora em `registerConversion`, então vale também para a API v1 e o
 * tool do agente). Resposta idêntica à de um id inexistente; nada gravado nem publicado.
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, schema } from '@hm/db';
import { outboxEventsNamed } from '../deals/__tests__/outbox';

vi.mock('../../middlewares/auth', async () =>
  (await import('../deals/__tests__/two-workspaces')).authMiddlewareMock(),
);

const { actAs, dropTenants, ghostId, seedTenant } =
  await import('../deals/__tests__/two-workspaces');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { createConversionEventsRouter } = await import('./events');

const app = express();
app.use(express.json());
app.use(createConversionEventsRouter());

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
  actAs(A);
});

/** Eventos `conversion.registered` de um workspace na outbox (F70-S17). */
async function registeredEvents(workspaceId: string): Promise<number> {
  return (await outboxEventsNamed(workspaceId, 'conversion.registered')).length;
}

async function conversionsOf(workspaceId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: schema.conversionEvents.id })
    .from(schema.conversionEvents)
    .where(eq(schema.conversionEvents.workspaceId, workspaceId));
  return rows.length;
}

describe('POST /api/conversions (F70-S11)', () => {
  const cases: ReadonlyArray<{ field: string; value: () => string }> = [
    { field: 'contactId', value: () => B.contact },
    { field: 'conversationId', value: () => B.conversation },
    { field: 'dealId', value: () => B.deal },
    { field: 'attributedChannelId', value: () => B.channel },
  ];

  for (const c of cases) {
    it(`${c.field} de B → 422, igual a inexistente, sem gravar nem publicar`, async () => {
      const base = { conversionTypeId: A.conversionType, contactId: A.contact };
      const res = await request(app)
        .post('/api/conversions')
        .send({ ...base, [c.field]: c.value() });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('invalid_reference');
      expect(res.body.fields).toEqual([c.field]);

      const ghost = await request(app)
        .post('/api/conversions')
        .send({ ...base, [c.field]: ghostId() });
      expect(ghost.status).toBe(422);
      expect(ghost.body).toEqual(res.body);

      expect(await conversionsOf(A.ws)).toBe(0);
      expect(await registeredEvents(A.ws)).toBe(0);
    });
  }

  it('caminho feliz com contato, conversa e deal próprios → 201 e publica', async () => {
    const res = await request(app).post('/api/conversions').send({
      conversionTypeId: A.conversionType,
      contactId: A.contact,
      conversationId: A.conversation,
      dealId: A.deal,
      attributedChannelId: A.channel,
    });
    expect(res.status).toBe(201);
    expect(res.body.conversion.workspaceId).toBe(A.ws);
    expect(await registeredEvents(A.ws)).toBe(1);
  });
});
