/**
 * F70-S20 — `message.sent` atômico com o status de envio, contra o Postgres de dev
 * (RLS real, papel `hm_app` do `withWorkspace`).
 *
 * `finalizeOutbound` passa o evento à porta de persistência real
 * (`DbOutboundPersistence`), que grava status, bump da conversa e outbox numa
 * transação só. Prova:
 *  - commit: `sent` + `external_id` + UMA linha `message.sent` com o eventId canônico;
 *  - rollback forçado depois de todo o trabalho, antes do COMMIT: nem status nem evento;
 *  - evento de outro workspace: a RLS da outbox recusa e o status também volta;
 *  - reprocessamento (redelivery do job): a mesma ocorrência, uma linha só.
 *
 * A outbox é lida por outra conexão (`../outbox/testing`): linha visível = commitada.
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Db from '@hm/db';

const FORCED = 'F70-S20: rollback forçado pelo teste';
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
const { domainEvents, domainEventsOutbox } = await import('@hm/shared/mq');
const { outboxEventsOf } = await import('../outbox/testing');
const { finalizeOutbound } = await import('./finalize');
const { DbOutboundPersistence } = await import('./db-ports');
const { parseOutboundJob } = await import('./job');
type OrphanStatusStore = import('../inbound/status').OrphanStatusStore;
type OutboundDeps = import('./ports').OutboundDeps;

const ready = Boolean(process.env['DATABASE_URL']);
const WS = randomUUID();
const CHANNEL = randomUUID();
const CONTACT = randomUUID();
const CONVERSATION = randomUUID();

const noOrphan: OrphanStatusStore = { record: async () => undefined, drain: async () => null };
const persistence = new DbOutboundPersistence();
const deps: OutboundDeps = {
  channels: { resolve: () => Promise.reject(new Error('não usado')) },
  persistence,
  socket: { emitStatusChanged: async () => undefined, emitMessageNew: async () => undefined },
};

async function pendingMessage(): Promise<string> {
  const [row] = await getDb()
    .insert(schema.messages)
    .values({
      workspaceId: WS,
      conversationId: CONVERSATION,
      direction: 'outbound',
      senderType: 'system',
      type: 'text',
      content: 'olá',
      viewStatus: 'pending',
    })
    .returning({ id: schema.messages.id });
  if (!row) throw new Error('fixture: mensagem');
  return row.id;
}

function textJob(messageId: string) {
  return parseOutboundJob({
    kind: 'text',
    channelId: CHANNEL,
    conversationId: CONVERSATION,
    messageId,
    chatId: '5511999990000',
    text: 'olá',
  });
}

async function messageRow(id: string) {
  const [row] = await getDb()
    .select({ viewStatus: schema.messages.viewStatus, externalId: schema.messages.externalId })
    .from(schema.messages)
    .where(eq(schema.messages.id, id));
  return row;
}

async function sentEventsOf(messageId: string) {
  return (await outboxEventsOf(WS)).filter(
    (e) => e.event === 'message.sent' && e.data['messageId'] === messageId,
  );
}

beforeAll(async () => {
  if (!ready) return;
  const db = getDb();
  await db.insert(schema.workspaces).values({ id: WS, name: 'F70-S20 sent', slug: `f70s20-${WS.slice(0, 8)}` });
  await db.insert(schema.contacts).values({ id: CONTACT, workspaceId: WS, phone: `+55119${WS.slice(0, 8)}` });
  await db.insert(schema.channels).values({
    id: CHANNEL,
    workspaceId: WS,
    provider: 'waha',
    name: 'Canal F70-S20',
    wahaSessionId: `s-${CHANNEL.slice(0, 8)}`,
  });
  await db.insert(schema.conversations).values({
    id: CONVERSATION,
    workspaceId: WS,
    channelId: CHANNEL,
    contactId: CONTACT,
    remoteId: '5511999990000',
    status: 'open',
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

describe.skipIf(!ready)('message.sent atômico com o status (F70-S20)', () => {
  it('commit: status sent, external_id e UM message.sent com o eventId canônico', async () => {
    const id = await pendingMessage();
    await finalizeOutbound(textJob(id), { ok: true, externalId: `wamid.${id}` }, WS, deps, noOrphan);

    expect(await messageRow(id)).toEqual({ viewStatus: 'sent', externalId: `wamid.${id}` });
    const events = await sentEventsOf(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventId: `${id}:sent`,
      workspaceId: WS,
      data: { conversationId: CONVERSATION, messageId: id, type: 'text', text: 'olá' },
    });
  });

  it('a gravação do status falha: o message.sent some junto', async () => {
    const id = await pendingMessage();
    rollback.armed = true;
    await expect(
      finalizeOutbound(textJob(id), { ok: true, externalId: `wamid.${id}` }, WS, deps, noOrphan),
    ).rejects.toThrow(FORCED);
    rollback.armed = false;

    expect(await messageRow(id)).toEqual({ viewStatus: 'pending', externalId: null });
    expect(await sentEventsOf(id)).toHaveLength(0);
  });

  it('evento de outro workspace: a RLS da outbox recusa e o status também volta', async () => {
    const id = await pendingMessage();
    const foreign = domainEventsOutbox([
      domainEvents.messageSent(randomUUID(), {
        conversationId: CONVERSATION,
        messageId: id,
        type: 'text',
        text: 'olá',
      }),
    ]);
    await expect(
      persistence.persist({
        workspaceId: WS,
        conversationId: CONVERSATION,
        messageId: id,
        status: 'sent',
        externalId: `wamid.${id}`,
        job: textJob(id),
        outbox: foreign,
      }),
    ).rejects.toThrow();
    expect(await messageRow(id)).toEqual({ viewStatus: 'pending', externalId: null });
  });

  it('reprocessamento do job (alreadySent): a mesma ocorrência, uma linha só', async () => {
    const id = await pendingMessage();
    const result = { ok: true as const, externalId: `wamid.${id}` };
    await finalizeOutbound(textJob(id), result, WS, deps, noOrphan);
    await finalizeOutbound(textJob(id), result, WS, deps, noOrphan);

    expect((await messageRow(id))?.viewStatus).toBe('sent');
    expect(await sentEventsOf(id)).toHaveLength(1);
  });
});
