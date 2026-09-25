/**
 * F70-S25 — `POST /api/conversations/:id/agent` grava o gatilho do agente de IA
 * (`flow.run.requested` → `hm.q.flows`) na outbox, na transação da troca (Postgres dev,
 * RLS real):
 *  - commit: IA `on`, agente trocado e UM job em `hm.q.flows` com o gatilho do contrato;
 *  - rollback forçado depois de todo o trabalho, antes do COMMIT: nem a troca nem o job.
 *
 * O relay de socket (AMQP) fica fora (mockado).
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
const { envelopeSchema } = await import('@hm/shared/mq');
const { actAs, dropTenants, seedTenant } = await import('../deals/__tests__/two-workspaces');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { createConversationAgentRouter } = await import('./agent');

const app = express();
app.use(express.json());
app.use(createConversationAgentRouter());

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

/** Jobs de `hm.q.flows` gravados (commitados) para a conversa. */
async function agentRunJobsOf(conversationId: string) {
  const rows = await getDb()
    .select()
    .from(schema.outbox)
    .where(and(eq(schema.outbox.workspaceId, A.ws), eq(schema.outbox.routingKey, 'hm.q.flows')));
  return rows
    .map((r) => ({ ...r, envelope: envelopeSchema.parse(r.envelope) }))
    .filter(
      (r) => (r.envelope.payload as Record<string, unknown>)['conversationId'] === conversationId,
    );
}

async function conversationOf(conversationId: string) {
  const [row] = await getDb()
    .select({ aiMode: schema.conversations.aiMode, agentId: schema.conversations.agentId })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId));
  return row;
}

describe('POST /api/conversations/:id/agent → gatilho da IA na outbox (F70-S25)', () => {
  it('commit: troca o agente, liga a IA e grava UM job em hm.q.flows', async () => {
    const res = await request(app)
      .post(`/api/conversations/${A.conversation}/agent`)
      .send({ agentId: A.agent });
    expect(res.status).toBe(200);

    expect(await conversationOf(A.conversation)).toEqual({ aiMode: 'on', agentId: A.agent });
    const jobs = await agentRunJobsOf(A.conversation);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'job', exchange: '', status: 'pending' });
    expect(jobs[0]?.eventId).toBe(jobs[0]?.envelope.id);
    expect(jobs[0]?.envelope).toMatchObject({ type: 'flow.run.requested', workspaceId: A.ws });
    expect(jobs[0]?.envelope.payload).toEqual({
      conversationId: A.conversation,
      contactId: A.contact,
      channelId: A.channel,
      provider: 'meta_whatsapp',
    });
  });

  it('rollback: a IA segue desligada e nada fica na outbox', async () => {
    expect(await conversationOf(A.freeConversation)).toMatchObject({
      aiMode: 'off',
      agentId: null,
    });
    rollback.armed = true;
    const res = await request(app)
      .post(`/api/conversations/${A.freeConversation}/agent`)
      .send({ agentId: A.agent });
    expect(res.status).toBe(500);
    rollback.armed = false;

    expect(await conversationOf(A.freeConversation)).toMatchObject({
      aiMode: 'off',
      agentId: null,
    });
    expect(await agentRunJobsOf(A.freeConversation)).toHaveLength(0);
  });
});
