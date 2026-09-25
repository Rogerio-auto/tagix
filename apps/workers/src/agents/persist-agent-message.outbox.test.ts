/**
 * F70-S21 — a resposta do agente grava o job de envio na outbox, na transação da
 * mensagem `pending` (`DbAgentRunStore.persistAgentMessage`, Postgres dev, RLS real):
 *  - commit: a mensagem do agente e UM job `text` em `hm.q.outbound`, no shape do worker;
 *  - rollback forçado depois de todo o trabalho, antes do COMMIT: nem a mensagem nem o
 *    job ficam.
 *
 * A outbox é lida por outra conexão (`../outbox/testing`): linha visível = commitada.
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Db from '@hm/db';

const FORCED = 'F70-S21: rollback forçado pelo teste';
const rollback = vi.hoisted(() => ({ armed: false }));
vi.mock('@hm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>();
  const withWorkspace: typeof actual.withWorkspace = (workspaceId, fn) =>
    actual.withWorkspace(workspaceId, async (tx) => {
      const out = await fn(tx);
      if (rollback.armed) throw new Error(FORCED);
      return out;
    });
  return { ...actual, withWorkspace };
});

const { closeDb, getDb, schema } = await import('@hm/db');
const { outboxRowsOf } = await import('../outbox/testing');
const { DbAgentRunStore } = await import('./run');
const { parseOutboundJob } = await import('../outbound/job');

const ready = Boolean(process.env['DATABASE_URL']);
const WS = randomUUID();
const CHANNEL = randomUUID();
const CONTACT = randomUUID();
const CONVERSATION = randomUUID();
const AGENT = randomUUID();
const REMOTE = '5511977776666';

const store = new DbAgentRunStore();

function persist(content: string) {
  return store.persistAgentMessage({
    workspaceId: WS,
    conversationId: CONVERSATION,
    agentId: AGENT,
    content,
    channelId: CHANNEL,
    chatId: REMOTE,
  });
}

async function agentMessagesWith(content: string) {
  return getDb()
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(and(eq(schema.messages.workspaceId, WS), eq(schema.messages.content, content)));
}

beforeAll(async () => {
  if (!ready) return;
  const db = getDb();
  await db
    .insert(schema.workspaces)
    .values({ id: WS, name: 'F70-S21 agents', slug: `f70s21-ag-${WS.slice(0, 8)}` });
  await db
    .insert(schema.contacts)
    .values({ id: CONTACT, workspaceId: WS, phone: `+55119${WS.slice(0, 8)}` });
  await db.insert(schema.channels).values({
    id: CHANNEL,
    workspaceId: WS,
    provider: 'waha',
    name: 'Canal F70-S21 agents',
    wahaSessionId: `s-${CHANNEL.slice(0, 8)}`,
  });
  await db.insert(schema.conversations).values({
    id: CONVERSATION,
    workspaceId: WS,
    channelId: CHANNEL,
    contactId: CONTACT,
    remoteId: REMOTE,
    status: 'open',
  });
  await db.insert(schema.agents).values({
    id: AGENT,
    workspaceId: WS,
    name: 'F70S21',
    systemPrompt: 'F70-S21',
    status: 'active',
  });
});

afterEach(() => {
  rollback.armed = false;
});

afterAll(async () => {
  rollback.armed = false;
  if (ready) await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
  await closeDb();
});

describe.skipIf(!ready)('resposta do agente → job de envio na outbox (F70-S21)', () => {
  it('commit: a mensagem pending do agente e UM job text, no shape do worker', async () => {
    const content = `f70s21-agent-${randomUUID()}`;
    const messageId = await persist(content);

    const [message] = await getDb()
      .select({
        viewStatus: schema.messages.viewStatus,
        senderType: schema.messages.senderType,
        senderAgentId: schema.messages.senderAgentId,
      })
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId));
    expect(message).toEqual({ viewStatus: 'pending', senderType: 'agent', senderAgentId: AGENT });

    const jobs = (await outboxRowsOf(WS)).filter(
      (r) => (r.envelope.payload as Record<string, unknown>)['messageId'] === messageId,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'job', exchange: '', routingKey: 'hm.q.outbound' });
    expect(jobs[0]?.eventId).toBe(jobs[0]?.envelope.id);
    expect(jobs[0]?.envelope).toMatchObject({ type: 'outbound.job', workspaceId: WS });
    expect(parseOutboundJob(jobs[0]?.envelope.payload)).toEqual({
      kind: 'text',
      channelId: CHANNEL,
      conversationId: CONVERSATION,
      messageId,
      chatId: REMOTE,
      text: content,
    });
  });

  it('rollback: nem a mensagem nem o job ficam', async () => {
    const content = `f70s21-agent-rb-${randomUUID()}`;
    const before = (await outboxRowsOf(WS)).length;

    rollback.armed = true;
    await expect(persist(content)).rejects.toThrow(FORCED);
    rollback.armed = false;

    expect(await agentMessagesWith(content)).toHaveLength(0);
    expect(await outboxRowsOf(WS)).toHaveLength(before);
  });
});
