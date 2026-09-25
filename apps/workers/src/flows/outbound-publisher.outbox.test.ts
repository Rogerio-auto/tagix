/**
 * F70-S21 — o envio de mensagem do flow grava o job na outbox, na transação da
 * mensagem `pending` (Postgres dev, RLS real do `withWorkspace`):
 *  - commit: a mensagem `pending` e UM job em `hm.q.outbound`, no shape do worker;
 *  - rollback forçado depois de todo o trabalho, antes do COMMIT: nem a mensagem nem o
 *    job ficam, e o `message:new` não é emitido;
 *  - conversa de outro workspace: nada é gravado.
 *
 * A outbox é lida por outra conexão (`../outbox/testing`): linha visível = commitada.
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Db from '@hm/db';
import { createLogger } from '@hm/logger';
import type { IStorageDriver, PutObjectInput, SignedUrl } from '@hm/storage';
import type { OutboundMessageNewEmit } from './outbound-publisher';

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
const { createDbOutboundPersistence, createOutboundPublisher } =
  await import('./outbound-publisher');
const { parseOutboundJob } = await import('../outbound/job');

const ready = Boolean(process.env['DATABASE_URL']);
const WS = randomUUID();
const CHANNEL = randomUUID();
const CONTACT = randomUUID();
const CONVERSATION = randomUUID();
const REMOTE = '5511988887777';

class FakeStorage implements IStorageDriver {
  async put(_input: PutObjectInput): Promise<void> {
    /* não usado */
  }
  async getSignedUrl(key: string): Promise<SignedUrl> {
    return { url: `https://cdn.test/${key}?sig=1`, expiresAt: new Date(Date.now() + 3_600_000) };
  }
  async delete(_key: string): Promise<void> {
    /* não usado */
  }
}

const emits: OutboundMessageNewEmit[] = [];
const presence: Record<string, unknown>[] = [];
const publisher = createOutboundPublisher({
  logger: createLogger('error'),
  storage: new FakeStorage(),
  persistence: createDbOutboundPersistence(),
  publishPresenceJob: async (_ws, job) => {
    presence.push(job);
    return true;
  },
  emitMessageNew: async (input) => {
    emits.push(input);
  },
});

async function jobsOf(messageId: string) {
  return (await outboxRowsOf(WS)).filter(
    (r) =>
      r.kind === 'job' &&
      (r.envelope.payload as Record<string, unknown>)['messageId'] === messageId,
  );
}

async function messagesWithContent(content: string) {
  return getDb()
    .select({ id: schema.messages.id, viewStatus: schema.messages.viewStatus })
    .from(schema.messages)
    .where(and(eq(schema.messages.workspaceId, WS), eq(schema.messages.content, content)));
}

beforeAll(async () => {
  if (!ready) return;
  const db = getDb();
  await db
    .insert(schema.workspaces)
    .values({ id: WS, name: 'F70-S21 flows', slug: `f70s21-fl-${WS.slice(0, 8)}` });
  await db
    .insert(schema.contacts)
    .values({ id: CONTACT, workspaceId: WS, phone: `+55119${WS.slice(0, 8)}` });
  await db.insert(schema.channels).values({
    id: CHANNEL,
    workspaceId: WS,
    provider: 'waha',
    name: 'Canal F70-S21 flows',
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
});

afterEach(() => {
  rollback.armed = false;
  emits.length = 0;
  presence.length = 0;
});

afterAll(async () => {
  rollback.armed = false;
  if (ready) await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
  await closeDb();
});

describe.skipIf(!ready)('flow → job de envio na outbox (F70-S21)', () => {
  it('commit (texto): a mensagem pending e UM job, no shape do worker', async () => {
    const text = `f70s21-flow-${randomUUID()}`;
    await publisher.publishMessage(WS, { conversationId: CONVERSATION, text });

    const [message] = await messagesWithContent(text);
    expect(message?.viewStatus).toBe('pending');
    const jobs = await jobsOf(message?.id ?? '');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ exchange: '', routingKey: 'hm.q.outbound', status: 'pending' });
    expect(jobs[0]?.eventId).toBe(jobs[0]?.envelope.id);
    expect(jobs[0]?.envelope).toMatchObject({ type: 'outbound.job', workspaceId: WS });
    expect(parseOutboundJob(jobs[0]?.envelope.payload)).toEqual({
      kind: 'text',
      channelId: CHANNEL,
      conversationId: CONVERSATION,
      messageId: message?.id,
      chatId: REMOTE,
      text,
    });
    expect(emits).toHaveLength(1);
    expect(presence).toHaveLength(0);
  });

  it('commit (mídia): o job leva a URL assinada, fora da transação', async () => {
    const caption = `f70s21-flow-media-${randomUUID()}`;
    await publisher.publishMessage(WS, {
      conversationId: CONVERSATION,
      mediaStorageKey: `${WS}/media/foto.png`,
      mediaType: 'image/png',
      caption,
    });

    const [message] = await messagesWithContent(caption);
    const jobs = await jobsOf(message?.id ?? '');
    expect(jobs).toHaveLength(1);
    expect(parseOutboundJob(jobs[0]?.envelope.payload)).toMatchObject({
      kind: 'media',
      mediaKind: 'image',
      publicMediaUrl: `https://cdn.test/${WS}/media/foto.png?sig=1`,
      mime: 'image/png',
      caption,
    });
  });

  it('rollback: nem a mensagem nem o job ficam, e nada é emitido', async () => {
    const text = `f70s21-flow-rb-${randomUUID()}`;
    const before = (await outboxRowsOf(WS)).length;

    rollback.armed = true;
    await expect(
      publisher.publishMessage(WS, { conversationId: CONVERSATION, text }),
    ).rejects.toThrow(FORCED);
    rollback.armed = false;

    expect(await messagesWithContent(text)).toHaveLength(0);
    expect(await outboxRowsOf(WS)).toHaveLength(before);
    expect(emits).toHaveLength(0);
  });

  it('conversa de outro workspace: no-op, nada gravado', async () => {
    const before = (await outboxRowsOf(WS)).length;
    await publisher.publishMessage(randomUUID(), { conversationId: CONVERSATION, text: 'x' });
    expect(await outboxRowsOf(WS)).toHaveLength(before);
    expect(emits).toHaveLength(0);
  });
});
