/**
 * F70-S25 — o gatilho do agente de IA (`flow.run.requested` → `hm.q.flows`) entra na outbox
 * na transação que insere a mensagem do contato (`DbInboundPersistence.persist`, Postgres
 * dev, RLS real do `withWorkspace`):
 *  - conversa com IA `on`: commit grava a mensagem e UM job, com `triggerExternalId` da
 *    última mensagem da requisição;
 *  - reentrega do mesmo envelope (mensagem deduplicada): nenhum job novo;
 *  - conversa com IA `off` e conversa criada agora (nasce `off`): nenhum job — o caminho
 *    de publicação mudou, quem pode ligar a IA não;
 *  - rollback forçado depois de todo o trabalho, antes do COMMIT: nem mensagem nem job.
 *
 * A outbox é lida por outra conexão (`../outbox/testing`): linha visível = commitada.
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Db from '@hm/db';
import type { InboundEvent } from '@hm/channels';
import { createLogger } from '@hm/logger';
import type { InboundSocketPort } from './db-ports';
import type { StatusDeps } from './status';
import type { PersistInboundRequest } from './ports';

const FORCED = 'F70-S25: rollback forçado pelo teste';
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
const { agentRunRequestedPayloadSchema, agentRunTriggerId } = await import('@hm/shared/mq');
const { outboxRowsOf } = await import('../outbox/testing');
const { DbInboundPersistence, INBOUND_FLOW_TYPE } = await import('./db-ports');
const { agentRunTriggerSchema } = await import('../agents/worker');

const ready = Boolean(process.env['DATABASE_URL']);
const WS = randomUUID();
const CHANNEL = randomUUID();
const CONTACT = randomUUID();
const PHONE_NUMBER_ID = `pn-f70s25-${CHANNEL.slice(0, 8)}`;
/** Conversa pré-existente com a IA ligada (origem de anúncio). */
const REMOTE_ON = '5511955550001';
/** Conversa pré-existente com a IA desligada. */
const REMOTE_OFF = '5511955550002';
/** Sem conversa: o inbound cria (nasce `off`). */
const REMOTE_NEW = '5511955550003';
let CONV_ON = '';
let CONV_OFF = '';

const noopSocket: InboundSocketPort = {
  async emitMessageNew() {},
  async emitContactPresence() {},
  async emitConversationAssigned() {},
};
const noopStatusDeps: StatusDeps = {
  channels: {
    async resolve() {
      return null;
    },
  },
  persistence: {
    async applyStatus() {
      return { outcome: 'not_found' as const };
    },
  },
  socket: { async emitStatusChanged() {} },
  orphan: {
    async record() {},
    async drain() {
      return null;
    },
  },
};

const persistence = new DbInboundPersistence(noopSocket, noopStatusDeps, createLogger('error'), {
  resolve: async () => ({ channelId: CHANNEL, workspaceId: WS }),
});

function request(events: InboundEvent[]): PersistInboundRequest {
  return { provider: 'meta_whatsapp', routing: { phoneNumberId: PHONE_NUMBER_ID }, events };
}

function textEvent(remote: string, externalId: string): InboundEvent {
  return {
    type: 'message',
    provider: 'meta_whatsapp',
    contactRemoteId: remote,
    externalId,
    messageType: 'text',
    content: 'oi, quero saber o preço',
    rawTimestamp: new Date().toISOString(),
  };
}

async function agentRunJobsOf(conversationId: string) {
  return (await outboxRowsOf(WS)).filter(
    (r) =>
      r.routingKey === 'hm.q.flows' &&
      (r.envelope.payload as Record<string, unknown>)['conversationId'] === conversationId,
  );
}

async function conversationByRemote(remote: string) {
  const [row] = await getDb()
    .select({ id: schema.conversations.id, aiMode: schema.conversations.aiMode })
    .from(schema.conversations)
    .where(
      and(eq(schema.conversations.channelId, CHANNEL), eq(schema.conversations.remoteId, remote)),
    );
  return row;
}

async function messageOf(externalId: string) {
  const [row] = await getDb()
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(and(eq(schema.messages.workspaceId, WS), eq(schema.messages.externalId, externalId)));
  return row;
}

beforeAll(async () => {
  if (!ready) return;
  const db = getDb();
  await db
    .insert(schema.workspaces)
    .values({ id: WS, name: 'F70-S25 inbound IA', slug: `f70s25-in-${WS.slice(0, 8)}` });
  await db.insert(schema.channels).values({
    id: CHANNEL,
    workspaceId: WS,
    provider: 'meta_whatsapp',
    name: 'WA F70-S25 inbound',
    phoneNumberId: PHONE_NUMBER_ID,
    wabaId: `waba-f70s25-${CHANNEL.slice(0, 8)}`,
  });
  await db.insert(schema.contacts).values({ id: CONTACT, workspaceId: WS, phone: REMOTE_ON });
  const [on] = await db
    .insert(schema.conversations)
    .values({
      workspaceId: WS,
      channelId: CHANNEL,
      contactId: CONTACT,
      remoteId: REMOTE_ON,
      aiMode: 'on',
      origin: 'origem:anuncio',
    })
    .returning({ id: schema.conversations.id });
  const [off] = await db
    .insert(schema.conversations)
    .values({
      workspaceId: WS,
      channelId: CHANNEL,
      contactId: CONTACT,
      remoteId: REMOTE_OFF,
      aiMode: 'off',
      origin: 'origem:anuncio',
    })
    .returning({ id: schema.conversations.id });
  CONV_ON = on?.id ?? '';
  CONV_OFF = off?.id ?? '';
});

afterEach(() => {
  rollback.armed = false;
});

afterAll(async () => {
  rollback.armed = false;
  if (ready) await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
  await closeDb();
});

describe.skipIf(!ready)('inbound → gatilho do agente na outbox (F70-S25)', () => {
  it('IA on: commit grava a mensagem e UM job em hm.q.flows (contrato do worker de agentes)', async () => {
    const first = `wamid.f70s25.a.${randomUUID()}`;
    const last = `wamid.f70s25.b.${randomUUID()}`;
    const result = await persistence.persist(
      request([textEvent(REMOTE_ON, first), textEvent(REMOTE_ON, last)]),
    );
    expect(result).toMatchObject({ inserted: 2 });

    const jobs = await agentRunJobsOf(CONV_ON);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'job', exchange: '', routingKey: 'hm.q.flows' });
    expect(jobs[0]?.eventId).toBe(jobs[0]?.envelope.id);
    expect(jobs[0]?.envelope).toMatchObject({ type: INBOUND_FLOW_TYPE, workspaceId: WS });
    const payload = agentRunRequestedPayloadSchema.parse(jobs[0]?.envelope.payload);
    expect(payload).toEqual({
      conversationId: CONV_ON,
      contactId: CONTACT,
      channelId: CHANNEL,
      provider: 'meta_whatsapp',
      triggerExternalId: last,
      // F70-S26: id estável do gatilho = conversa + mensagem.
      triggerId: agentRunTriggerId.inbound(CONV_ON, last),
    });
    // O consumidor aceita o que o produtor grava.
    expect(agentRunTriggerSchema.safeParse(jobs[0]?.envelope.payload).success).toBe(true);
  });

  it('lote com reentrega no fim: o gatilho aponta para a mensagem NOVA (F70-S26)', async () => {
    const old = `wamid.f70s26.old.${randomUUID()}`;
    await persistence.persist(request([textEvent(REMOTE_ON, old)]));
    const before = (await agentRunJobsOf(CONV_ON)).length;

    const fresh = `wamid.f70s26.new.${randomUUID()}`;
    const result = await persistence.persist(
      request([textEvent(REMOTE_ON, fresh), textEvent(REMOTE_ON, old)]),
    );
    expect(result).toMatchObject({ inserted: 1, deduped: 1 });

    const jobs = await agentRunJobsOf(CONV_ON);
    expect(jobs).toHaveLength(before + 1);
    const payloads = jobs.map((j) => agentRunRequestedPayloadSchema.parse(j.envelope.payload));
    // Um gatilho por mensagem: o antigo continua único e o novo aponta para a nova.
    expect(payloads.filter((p) => p.triggerExternalId === old)).toHaveLength(1);
    const forFresh = payloads.filter((p) => p.triggerExternalId === fresh);
    expect(forFresh).toHaveLength(1);
    expect(forFresh[0]?.triggerId).toBe(agentRunTriggerId.inbound(CONV_ON, fresh));
  });

  it('reentrega do mesmo envelope: mensagem deduplicada, nenhum job novo', async () => {
    const before = (await agentRunJobsOf(CONV_ON)).length;
    const externalId = `wamid.f70s25.dup.${randomUUID()}`;
    await persistence.persist(request([textEvent(REMOTE_ON, externalId)]));
    const again = await persistence.persist(request([textEvent(REMOTE_ON, externalId)]));
    expect(again).toMatchObject({ inserted: 0, deduped: 1 });
    expect(await agentRunJobsOf(CONV_ON)).toHaveLength(before + 1);
  });

  it('IA off, ou conversa criada agora: mensagem gravada e nenhum job', async () => {
    await persistence.persist(request([textEvent(REMOTE_OFF, `wamid.f70s25.off.${randomUUID()}`)]));
    expect(await agentRunJobsOf(CONV_OFF)).toHaveLength(0);

    await persistence.persist(request([textEvent(REMOTE_NEW, `wamid.f70s25.new.${randomUUID()}`)]));
    const created = await conversationByRemote(REMOTE_NEW);
    expect(created?.aiMode).toBe('off');
    expect(await agentRunJobsOf(created?.id ?? '')).toHaveLength(0);
  });

  it('rollback: nem a mensagem nem o job ficam', async () => {
    const before = (await agentRunJobsOf(CONV_ON)).length;
    const externalId = `wamid.f70s25.rb.${randomUUID()}`;
    rollback.armed = true;
    await expect(persistence.persist(request([textEvent(REMOTE_ON, externalId)]))).rejects.toThrow(
      FORCED,
    );
    rollback.armed = false;

    expect(await messageOf(externalId)).toBeUndefined();
    expect(await agentRunJobsOf(CONV_ON)).toHaveLength(before);
  });
});
