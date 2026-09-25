/**
 * F70-S17 — `POST /api/conversations/:id/status` grava os eventos de domínio na
 * outbox, na transação da transição (Postgres dev, RLS real):
 *  - resolver → `conversation.resolved` (autor membro);
 *  - reabrir resolvida → `conversation.opened` com `trigger: reopened`;
 *  - transição que não muda nada (resolver resolvida) → nenhuma linha;
 *  - rollback forçado depois de todo o trabalho, antes do COMMIT → nem a transição
 *    nem o evento ficam.
 *
 * O relay de socket (AMQP) e as métricas do dashboard ficam fora (mockados).
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type * as Db from '@hm/db';
import type * as Mq from '@hm/shared/mq';

const rollback = vi.hoisted(() => ({ armed: false }));
vi.mock('@hm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>();
  const { armableWithWorkspace } = await import('../deals/__tests__/forced-rollback');
  return { ...actual, withWorkspace: armableWithWorkspace(actual.withWorkspace, rollback) };
});
vi.mock('../../middlewares/auth', async () =>
  (await import('../deals/__tests__/two-workspaces')).authMiddlewareMock(),
);
vi.mock('@hm/shared/mq', async (importOriginal) => ({
  ...(await importOriginal<typeof Mq>()),
  connectMq: vi.fn(async () => ({ channel: { sendToQueue: vi.fn() }, connection: {} })),
}));
vi.mock('../../services/dashboard/emit', () => ({
  emitConversationResolvedMetrics: vi.fn(async () => undefined),
}));

const { closeDb, getDb, schema } = await import('@hm/db');
const { actAs, dropTenants, seedTenant } = await import('../deals/__tests__/two-workspaces');
const { outboxEventsOf } = await import('../deals/__tests__/outbox');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { createConversationStateRouter } = await import('./state');

const app = express();
app.use(express.json());
app.use(createConversationStateRouter());

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

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

async function eventsOfConversation(conversationId: string) {
  return (await outboxEventsOf(A.ws)).filter((r) => r.data['conversationId'] === conversationId);
}

async function statusOf(conversationId: string): Promise<string | undefined> {
  const [row] = await getDb()
    .select({ status: schema.conversations.status })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId));
  return row?.status;
}

function setStatus(conversationId: string, status: string) {
  return request(app).post(`/api/conversations/${conversationId}/status`).send({ status });
}

describe('POST /api/conversations/:id/status → outbox (F70-S17)', () => {
  it('resolver: uma linha conversation.resolved com o event_id canônico', async () => {
    const res = await setStatus(A.conversation, 'resolved');
    expect(res.status).toBe(200);

    const rows = await eventsOfConversation(A.conversation);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventId).toMatch(new RegExp(`^${A.conversation}:resolved:${UUID}$`));
    expect(rows[0]).toMatchObject({
      kind: 'event',
      exchange: 'hm.events',
      routingKey: 'domain.conversation.resolved',
      workspaceId: A.ws,
    });
    expect(rows[0]?.data).toEqual({
      conversationId: A.conversation,
      resolvedBy: 'member',
      memberId: A.member,
      agentId: null,
    });
  });

  it('resolver o que já está resolvido não grava outra linha', async () => {
    const res = await setStatus(A.conversation, 'resolved');
    expect(res.status).toBe(200);
    expect(await eventsOfConversation(A.conversation)).toHaveLength(1);
  });

  it('reabrir: uma linha conversation.opened (reopened) com ocorrência própria', async () => {
    const res = await setStatus(A.conversation, 'open');
    expect(res.status).toBe(200);

    const opened = (await eventsOfConversation(A.conversation)).filter(
      (r) => r.event === 'conversation.opened',
    );
    expect(opened).toHaveLength(1);
    expect(opened[0]?.eventId).toMatch(new RegExp(`^${A.conversation}:reopened:${UUID}$`));
    expect(opened[0]?.routingKey).toBe('domain.conversation.opened');
    expect(opened[0]?.data).toEqual({
      conversationId: A.conversation,
      contactId: A.contact,
      channelId: A.channel,
      trigger: 'reopened',
    });
  });

  it('rollback: a conversa segue aberta e nada fica na outbox', async () => {
    expect(await statusOf(A.freeConversation)).toBe('open');
    rollback.armed = true;
    const res = await setStatus(A.freeConversation, 'resolved');
    expect(res.status).toBe(500);
    rollback.armed = false;

    expect(await statusOf(A.freeConversation)).toBe('open');
    expect(await eventsOfConversation(A.freeConversation)).toHaveLength(0);
  });
});
