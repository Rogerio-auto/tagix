/**
 * F70-S21 — envio do LiveChat (`POST /api/conversations/:id/messages`) grava o job de
 * envio na outbox, na transação da mensagem `pending` (Postgres dev, RLS real):
 *  - commit: a mensagem `pending` e UM job em `hm.q.outbound`, no shape do worker;
 *  - replay idempotente (mesma `Idempotency-Key`): nenhum job novo;
 *  - rollback forçado depois de todo o trabalho, antes do COMMIT: nem a mensagem nem
 *    o job ficam.
 *
 * O relay de socket (AMQP) fica fora (mockado).
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
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

const { closeDb, getDb, schema } = await import('@hm/db');
const { actAs, dropTenants, seedTenant } = await import('../deals/__tests__/two-workspaces');
const { outboxJobsOf, outboxJobsOfMessage } = await import('./__tests__/outbox-jobs');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { createMessagesRouter } = await import('./messages');

const app = express();
app.use(express.json());
app.use(createMessagesRouter());

let A: TenantFixture;
let remoteId = '';

beforeAll(async () => {
  A = await seedTenant('A');
  const [conv] = await getDb()
    .select({ remoteId: schema.conversations.remoteId })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, A.conversation));
  if (!conv) throw new Error('fixture: conversa');
  remoteId = conv.remoteId;
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

function send(content: string, idempotencyKey?: string) {
  const req = request(app).post(`/api/conversations/${A.conversation}/messages`);
  if (idempotencyKey !== undefined) req.set('Idempotency-Key', idempotencyKey);
  return req.send({ type: 'text', content });
}

async function messagesWithContent(content: string) {
  return getDb()
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(and(eq(schema.messages.workspaceId, A.ws), eq(schema.messages.content, content)));
}

describe('POST /api/conversations/:id/messages → job de envio na outbox (F70-S21)', () => {
  it('commit: a mensagem pending e UM job em hm.q.outbound, com o shape do worker', async () => {
    const content = `f70s21-livechat-${randomUUID()}`;
    const before = (await outboxJobsOf(A.ws)).length;

    const res = await send(content);
    expect(res.status).toBe(201);
    const messageId: string = res.body.message.id;
    expect(res.body.message.viewStatus).toBe('pending');

    expect(await outboxJobsOf(A.ws)).toHaveLength(before + 1);
    const jobs = await outboxJobsOfMessage(A.ws, messageId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      exchange: '',
      routingKey: 'hm.q.outbound',
      type: 'outbound.job',
      envelopeWorkspaceId: A.ws,
    });
    // Chave de idempotência da outbox = id do envelope (queueJobOutbox).
    expect(jobs[0]?.eventId).toBe(jobs[0]?.envelopeId);
    expect(jobs[0]?.payload).toEqual({
      kind: 'text',
      channelId: A.channel,
      conversationId: A.conversation,
      messageId,
      chatId: remoteId,
      text: content,
    });
  });

  it('replay pela mesma Idempotency-Key: 200 e nenhum job novo', async () => {
    const content = `f70s21-livechat-idem-${randomUUID()}`;
    const key = `f70s21-${randomUUID()}`;
    const first = await send(content, key);
    expect(first.status).toBe(201);
    const count = (await outboxJobsOf(A.ws)).length;

    const again = await send(content, key);
    expect(again.status).toBe(200);
    expect(again.body.message.id).toBe(first.body.message.id);
    expect(await outboxJobsOf(A.ws)).toHaveLength(count);
  });

  it('rollback: nem a mensagem nem o job ficam', async () => {
    const content = `f70s21-livechat-rb-${randomUUID()}`;
    const before = (await outboxJobsOf(A.ws)).length;

    rollback.armed = true;
    const res = await send(content);
    expect(res.status).toBe(500);
    rollback.armed = false;

    expect(await messagesWithContent(content)).toHaveLength(0);
    expect(await outboxJobsOf(A.ws)).toHaveLength(before);
  });

  it('conversa fora do workspace: 404 e nenhum job', async () => {
    const before = (await outboxJobsOf(A.ws)).length;
    const res = await request(app)
      .post(`/api/conversations/${randomUUID()}/messages`)
      .send({ type: 'text', content: 'x' });
    expect(res.status).toBe(404);
    expect(await outboxJobsOf(A.ws)).toHaveLength(before);
  });
});
