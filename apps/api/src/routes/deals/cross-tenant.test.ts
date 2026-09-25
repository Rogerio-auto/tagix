/**
 * F70-S11 — deals POST/PUT recusam referência de outro workspace (Postgres dev, RLS real).
 *
 * Prova, com dois workspaces reais (A e B):
 *  - A não cria nem edita deal com pipeline, estágio, contato, conversa ou dono de B;
 *  - a resposta é idêntica à de um UUID que não existe (sem oráculo de existência);
 *  - B continua criando o card da própria conversa depois da tentativa de A;
 *  - estágio de outro pipeline (mesmo workspace) é recusado;
 *  - conversa que já tem card → 409 (antes: 500 pelo `uq_deals_conversation`);
 *  - referência recusada NÃO publica evento de domínio (F70-S09);
 *  - o caminho feliz segue funcionando.
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, schema } from '@hm/db';
import type * as Mq from '@hm/shared/mq';

vi.mock('../../middlewares/auth', async () =>
  (await import('./__tests__/two-workspaces')).authMiddlewareMock(),
);
const { emitDomainEvent } = vi.hoisted(() => ({ emitDomainEvent: vi.fn(async () => true) }));
vi.mock('@hm/shared/mq', async (importOriginal) => ({
  ...(await importOriginal<typeof Mq>()),
  emitDomainEvent,
}));

const { actAs, dropTenants, ghostId, seedTenant } = await import('./__tests__/two-workspaces');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { createDealsCrudRouter } = await import('./crud');
const { createDealConversationRouter } = await import('../pipeline/deal-conversation');

const app = express();
app.use(express.json());
app.use(createDealConversationRouter());
app.use(createDealsCrudRouter());

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
  emitDomainEvent.mockClear();
  actAs(A);
});

function validDeal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pipelineId: A.pipeline,
    stageId: A.stage,
    contactId: A.contact,
    title: 'Negócio',
    ...overrides,
  };
}

async function dealsWithConversation(conversationId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: schema.deals.id })
    .from(schema.deals)
    .where(eq(schema.deals.conversationId, conversationId));
  return rows.length;
}

describe('POST /api/deals — referências de outro workspace (F70-S11)', () => {
  const cases: ReadonlyArray<{ field: string; foreign: () => Record<string, unknown> }> = [
    { field: 'contactId', foreign: () => ({ contactId: B.contact }) },
    { field: 'conversationId', foreign: () => ({ conversationId: B.freeConversation }) },
    { field: 'ownerId', foreign: () => ({ ownerId: B.member }) },
    { field: 'stageId', foreign: () => ({ stageId: B.stage }) },
    { field: 'pipelineId', foreign: () => ({ pipelineId: B.pipeline, stageId: B.stage }) },
  ];

  for (const c of cases) {
    it(`${c.field} de B → 422, igual a um id inexistente, sem gravar nem publicar`, async () => {
      const foreignBody = c.foreign();
      const res = await request(app).post('/api/deals').send(validDeal(foreignBody));
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('invalid_reference');
      expect(res.body.fields).toContain(c.field);

      // Mesmo payload, trocando cada id de B por um UUID que não existe.
      const ghostBody = Object.fromEntries(Object.keys(foreignBody).map((k) => [k, ghostId()]));
      const ghost = await request(app).post('/api/deals').send(validDeal(ghostBody));
      expect(ghost.status).toBe(res.status);
      expect(ghost.body).toEqual(res.body);

      expect(emitDomainEvent).not.toHaveBeenCalled();
    });
  }

  it('B continua criando o card da própria conversa depois da tentativa de A', async () => {
    const attempt = await request(app)
      .post('/api/deals')
      .send(validDeal({ conversationId: B.freeConversation }));
    expect(attempt.status).toBe(422);
    expect(await dealsWithConversation(B.freeConversation)).toBe(0);

    actAs(B);
    const own = await request(app).post(`/api/conversations/${B.freeConversation}/deal`).send({});
    expect(own.status).toBe(201);
    expect(own.body.deal.workspaceId).toBe(B.ws);
    expect(own.body.deal.conversationId).toBe(B.freeConversation);
  });

  it('estágio de OUTRO pipeline do mesmo workspace → 422 stageId', async () => {
    const res = await request(app)
      .post('/api/deals')
      .send(validDeal({ stageId: A.otherStage }));
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual(['stageId']);
  });

  it('caminho feliz: 201, publica deal.created; a mesma conversa de novo → 409', async () => {
    const res = await request(app)
      .post('/api/deals')
      .send(validDeal({ conversationId: A.conversation, ownerId: A.otherMember }));
    expect(res.status).toBe(201);
    expect(res.body.deal.workspaceId).toBe(A.ws);
    expect(emitDomainEvent).toHaveBeenCalledTimes(1);

    emitDomainEvent.mockClear();
    const dup = await request(app)
      .post('/api/deals')
      .send(validDeal({ conversationId: A.conversation, title: 'Outro' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('conversation_already_has_deal');
    expect(emitDomainEvent).not.toHaveBeenCalled();
  });
});

describe('PUT /api/deals/:id — referências de outro workspace (F70-S11)', () => {
  it('ownerId de B → 422 e o deal não muda', async () => {
    const res = await request(app).put(`/api/deals/${A.deal}`).send({ ownerId: B.member });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual(['ownerId']);
    const ghost = await request(app).put(`/api/deals/${A.deal}`).send({ ownerId: ghostId() });
    expect(ghost.body).toEqual(res.body);
    const [row] = await getDb()
      .select({ ownerId: schema.deals.ownerId })
      .from(schema.deals)
      .where(eq(schema.deals.id, A.deal));
    expect(row?.ownerId).toBeNull();
  });

  it('conversationId de B → 422, igual a inexistente', async () => {
    const res = await request(app)
      .put(`/api/deals/${A.deal}`)
      .send({ conversationId: B.conversation });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual(['conversationId']);
    const ghost = await request(app)
      .put(`/api/deals/${A.deal}`)
      .send({ conversationId: ghostId() });
    expect(ghost.body).toEqual(res.body);
    expect(await dealsWithConversation(B.conversation)).toBe(0);
  });

  it('deal de B visto de A → 404 antes de olhar o payload', async () => {
    const res = await request(app).put(`/api/deals/${B.deal}`).send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  it('caminho feliz: dono e título do próprio workspace → 200', async () => {
    const res = await request(app)
      .put(`/api/deals/${A.deal}`)
      .send({ ownerId: A.otherMember, title: 'Renomeado' });
    expect(res.status).toBe(200);
    expect(res.body.deal.ownerId).toBe(A.otherMember);
    const [row] = await getDb()
      .select({ title: schema.deals.title })
      .from(schema.deals)
      .where(and(eq(schema.deals.id, A.deal), eq(schema.deals.workspaceId, A.ws)));
    expect(row?.title).toBe('Renomeado');
  });

  it('conversa que já tem card em outro deal → 409', async () => {
    // O teste do POST ligou A.conversation a um deal; ligar A.deal nela colide.
    const res = await request(app)
      .put(`/api/deals/${A.deal}`)
      .send({ conversationId: A.conversation });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('conversation_already_has_deal');
  });
});
