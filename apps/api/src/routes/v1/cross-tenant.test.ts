/**
 * F70-S11 — API pública v1 recusa referência de outro workspace:
 *  - `POST /api/v1/trigger_flow` (conversa/contato, antes de chamar o engine);
 *  - `POST /api/v1/conversions` (contato/conversa/deal, trava em `registerConversion`);
 *  - `POST /api/v1/events` (contato, trava no `event-service`).
 *
 * A chave de API é mockada para isolar o teste do Redis do rate limit: o tenant vem de
 * `req.apiAuth.workspaceId`, exatamente o que o middleware real injeta.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, schema } from '@hm/db';
import type * as FlowEngine from '@hm/flow-engine';

const { keyWorkspace, triggerFlow } = vi.hoisted(() => ({
  keyWorkspace: { id: '' },
  triggerFlow: vi.fn(async () => ({ executionId: '00000000-0000-4000-8000-000000000002' })),
}));
vi.mock('../../middlewares/api-key', () => ({
  requireApiKey: (req: Request, _res: Response, next: NextFunction) => {
    req.apiAuth = { workspaceId: keyWorkspace.id } as Request['apiAuth'];
    next();
  },
  requireScope: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  closeApiKeyRateLimiter: async () => {},
}));
vi.mock('@hm/flow-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof FlowEngine>()),
  triggerFlow,
}));

const { dropTenants, ghostId, seedTenant } = await import('../deals/__tests__/two-workspaces');
const { outboxEventsNamed } = await import('../deals/__tests__/outbox');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { createV1Router } = await import('./index');

const app = express();
app.use(express.json());
app.use(createV1Router());

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
  keyWorkspace.id = A.ws;
  triggerFlow.mockClear();
});

/** Eventos `conversion.registered` de um workspace na outbox (F70-S17). */
async function registeredEvents(workspaceId: string): Promise<number> {
  return (await outboxEventsNamed(workspaceId, 'conversion.registered')).length;
}

describe('POST /api/v1/trigger_flow (F70-S11)', () => {
  for (const field of ['conversationId', 'contactId'] as const) {
    it(`${field} de B → 422, igual a inexistente, sem disparar`, async () => {
      const foreign = field === 'conversationId' ? B.conversation : B.contact;
      const res = await request(app)
        .post('/api/v1/trigger_flow')
        .send({ flowId: A.flow, [field]: foreign });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('invalid_reference');
      expect(res.body.fields).toEqual([field]);
      const ghost = await request(app)
        .post('/api/v1/trigger_flow')
        .send({ flowId: A.flow, [field]: ghostId() });
      expect(ghost.body).toEqual(res.body);
      expect(triggerFlow).not.toHaveBeenCalled();
    });
  }

  it('caminho feliz → 202', async () => {
    const res = await request(app)
      .post('/api/v1/trigger_flow')
      .send({ flowId: A.flow, conversationId: A.conversation, contactId: A.contact });
    expect(res.status).toBe(202);
    expect(triggerFlow).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/v1/conversions (F70-S11)', () => {
  const cases: ReadonlyArray<{ field: string; foreign: () => string }> = [
    { field: 'contactId', foreign: () => B.contact },
    { field: 'conversationId', foreign: () => B.conversation },
    { field: 'dealId', foreign: () => B.deal },
  ];
  for (const c of cases) {
    it(`${c.field} de B → 422, igual a inexistente, sem gravar nem publicar`, async () => {
      const base = { conversionTypeKey: A.conversionTypeKey, contactId: A.contact };
      const res = await request(app)
        .post('/api/v1/conversions')
        .send({ ...base, [c.field]: c.foreign() });
      expect(res.status).toBe(422);
      expect(res.body.fields).toEqual([c.field]);
      const ghost = await request(app)
        .post('/api/v1/conversions')
        .send({ ...base, [c.field]: ghostId() });
      expect(ghost.body).toEqual(res.body);
      const rows = await getDb()
        .select({ id: schema.conversionEvents.id })
        .from(schema.conversionEvents)
        .where(eq(schema.conversionEvents.workspaceId, A.ws));
      expect(rows).toHaveLength(0);
      expect(await registeredEvents(A.ws)).toBe(0);
    });
  }

  it('caminho feliz → 201 e publica', async () => {
    const res = await request(app).post('/api/v1/conversions').send({
      conversionTypeKey: A.conversionTypeKey,
      contactId: A.contact,
      conversationId: A.conversation,
      dealId: A.deal,
    });
    expect(res.status).toBe(201);
    expect(await registeredEvents(A.ws)).toBe(1);
  });
});

describe('POST /api/v1/events (F70-S11)', () => {
  const base = (): Record<string, unknown> => ({
    calendarId: A.calendar,
    title: 'Visita',
    startAt: '2026-10-02T13:00:00.000Z',
    endAt: '2026-10-02T14:00:00.000Z',
  });

  it('contactId de B → 422, igual a inexistente', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .send({ ...base(), contactId: B.contact });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_reference');
    expect(res.body.fields).toEqual(['contactId']);
    const ghost = await request(app)
      .post('/api/v1/events')
      .send({ ...base(), contactId: ghostId() });
    expect(ghost.body).toEqual(res.body);
  });

  it('calendário de B → 404 calendar_not_found, igual a inexistente', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .send({ ...base(), calendarId: B.calendar });
    const ghost = await request(app)
      .post('/api/v1/events')
      .send({ ...base(), calendarId: ghostId() });
    expect(res.status).toBe(404);
    expect(ghost.status).toBe(404);
    expect(ghost.body).toEqual(res.body);
  });

  it('caminho feliz → 201', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .send({ ...base(), contactId: A.contact });
    expect(res.status).toBe(201);
    expect(res.body.event.workspaceId).toBe(A.ws);
  });
});
