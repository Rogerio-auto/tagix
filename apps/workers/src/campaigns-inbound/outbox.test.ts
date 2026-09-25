/**
 * F70-S25 — campaigns-inbound pela outbox, na transação do dado (Postgres dev, RLS real do
 * `withWorkspace`):
 *  - opt-out: o contato sai, e a confirmação vira uma mensagem `pending` REAL na conversa
 *    com UM job de envio que aponta para ela (antes: `messageId: 'opt-out-confirm'`, sem
 *    linha em `messages`), aceito pelo contrato do worker outbound;
 *  - reply com followup `on_reply`: a marca de resposta e UM job em `hm.q.campaigns`;
 *    sem followup, só a marca;
 *  - rollback forçado depois de todo o trabalho, antes do COMMIT: nada fica.
 *
 * A outbox é lida por outra conexão (`../outbox/testing`): linha visível = commitada.
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Db from '@hm/db';
import { createLogger } from '@hm/logger';
import type { InboundMessage } from './processor';

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
const { outboxRowsOf } = await import('../outbox/testing');
const { parseOutboundJob } = await import('../outbound/job');
const { createCampaignInboundPorts, OPT_OUT_CONFIRMATION_TEXT, CAMPAIGN_FOLLOWUP_TYPE } =
  await import('./db-ports');

const ready = Boolean(process.env['DATABASE_URL']);
const WS = randomUUID();
const CHANNEL = randomUUID();
const CAMPAIGN = randomUUID();
const sfx = WS.slice(0, 8);

const ports = createCampaignInboundPorts({ logger: createLogger('error') });

let seq = 0;
async function contactWithConversation(): Promise<InboundMessage & { remoteId: string }> {
  seq += 1;
  const remoteId = `55119${sfx.replace(/\D/g, '8').padEnd(6, '8').slice(0, 6)}${String(seq).padStart(2, '0')}`;
  const [contact] = await getDb()
    .insert(schema.contacts)
    .values({ workspaceId: WS, phone: remoteId, marketingOptIn: true })
    .returning({ id: schema.contacts.id });
  const [conv] = await getDb()
    .insert(schema.conversations)
    .values({ workspaceId: WS, channelId: CHANNEL, contactId: contact?.id, remoteId })
    .returning({ id: schema.conversations.id });
  if (!contact || !conv) throw new Error('fixture: contato/conversa');
  return {
    workspaceId: WS,
    channelId: CHANNEL,
    contactId: contact.id,
    conversationId: conv.id,
    text: 'PARAR',
    remoteId,
  };
}

async function recipientOf(contactId: string): Promise<string> {
  const [row] = await getDb()
    .insert(schema.campaignRecipients)
    .values({ workspaceId: WS, campaignId: CAMPAIGN, contactId, status: 'sending' })
    .returning({ id: schema.campaignRecipients.id });
  if (!row) throw new Error('fixture: recipient');
  return row.id;
}

async function jobs(routingKey: string, field: string, value: string) {
  return (await outboxRowsOf(WS)).filter(
    (r) =>
      r.routingKey === routingKey &&
      (r.envelope.payload as Record<string, unknown>)[field] === value,
  );
}

async function messagesOf(conversationId: string) {
  return getDb()
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId));
}

async function contactOf(contactId: string) {
  const [row] = await getDb()
    .select({ marketingOptIn: schema.contacts.marketingOptIn })
    .from(schema.contacts)
    .where(eq(schema.contacts.id, contactId));
  return row;
}

async function recipientState(id: string) {
  const [row] = await getDb()
    .select({ status: schema.campaignRecipients.status })
    .from(schema.campaignRecipients)
    .where(eq(schema.campaignRecipients.id, id));
  return row?.status;
}

beforeAll(async () => {
  if (!ready) return;
  const db = getDb();
  await db
    .insert(schema.workspaces)
    .values({ id: WS, name: 'F70S25 camp-in', slug: `f70s25-ci-${sfx}` });
  await db.insert(schema.channels).values({
    id: CHANNEL,
    workspaceId: WS,
    provider: 'meta_whatsapp',
    name: 'WA F70S25 camp-in',
    phoneNumberId: `PN_F70S25_CI_${sfx}`,
    wabaId: `WABA_F70S25_CI_${sfx}`,
  });
  await db
    .insert(schema.campaigns)
    .values({
      id: CAMPAIGN,
      workspaceId: WS,
      channelId: CHANNEL,
      name: 'Camp F70-S25',
      type: 'broadcast',
    });
});

afterEach(() => {
  rollback.armed = false;
});

afterAll(async () => {
  rollback.armed = false;
  if (ready) {
    await getDb().delete(schema.campaigns).where(eq(schema.campaigns.workspaceId, WS));
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
  }
  await closeDb();
});

describe.skipIf(!ready)('opt-out → confirmação com mensagem real pela outbox (F70-S25)', () => {
  it('commit: contato fora, mensagem pending e UM job que aponta para ela', async () => {
    const msg = await contactWithConversation();
    await ports.optOutContact(msg, 'KEYWORD_STOP');

    expect((await contactOf(msg.contactId))?.marketingOptIn).toBe(false);
    const msgs = await messagesOf(msg.conversationId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      direction: 'outbound',
      senderType: 'system',
      type: 'text',
      content: OPT_OUT_CONFIRMATION_TEXT,
      viewStatus: 'pending',
    });
    const sent = await jobs('hm.q.outbound', 'conversationId', msg.conversationId);
    expect(sent).toHaveLength(1);
    expect(parseOutboundJob(sent[0]?.envelope.payload)).toMatchObject({
      kind: 'text',
      channelId: CHANNEL,
      conversationId: msg.conversationId,
      messageId: msgs[0]?.id,
      chatId: msg.remoteId,
      text: OPT_OUT_CONFIRMATION_TEXT,
    });
  });

  it('rollback: o contato segue com opt-in, sem mensagem e sem job', async () => {
    const msg = await contactWithConversation();
    rollback.armed = true;
    await expect(ports.optOutContact(msg, 'KEYWORD_STOP')).rejects.toThrow(FORCED);
    rollback.armed = false;

    expect((await contactOf(msg.contactId))?.marketingOptIn).toBe(true);
    expect(await messagesOf(msg.conversationId)).toHaveLength(0);
    expect(await jobs('hm.q.outbound', 'conversationId', msg.conversationId)).toHaveLength(0);
  });
});

describe.skipIf(!ready)('reply → followup on_reply pela outbox, com a marca (F70-S25)', () => {
  it('com followup: recipient respondido e UM job em hm.q.campaigns', async () => {
    const msg = await contactWithConversation();
    const recipient = await recipientOf(msg.contactId);
    await ports.markRecipientResponded(WS, recipient, { campaignId: CAMPAIGN });

    expect(await recipientState(recipient)).toBe('responded');
    const followups = await jobs('hm.q.campaigns', 'recipientId', recipient);
    expect(followups).toHaveLength(1);
    expect(followups[0]).toMatchObject({ kind: 'job', exchange: '' });
    expect(followups[0]?.envelope).toMatchObject({
      type: CAMPAIGN_FOLLOWUP_TYPE,
      workspaceId: WS,
      payload: { campaignId: CAMPAIGN, recipientId: recipient, event: 'on_reply' },
    });
  });

  it('sem followup: só a marca', async () => {
    const msg = await contactWithConversation();
    const recipient = await recipientOf(msg.contactId);
    await ports.markRecipientResponded(WS, recipient, null);
    expect(await recipientState(recipient)).toBe('responded');
    expect(await jobs('hm.q.campaigns', 'recipientId', recipient)).toHaveLength(0);
  });

  it('rollback: nem a marca nem o followup', async () => {
    const msg = await contactWithConversation();
    const recipient = await recipientOf(msg.contactId);
    rollback.armed = true;
    await expect(
      ports.markRecipientResponded(WS, recipient, { campaignId: CAMPAIGN }),
    ).rejects.toThrow(FORCED);
    rollback.armed = false;

    expect(await recipientState(recipient)).toBe('sending');
    expect(await jobs('hm.q.campaigns', 'recipientId', recipient)).toHaveLength(0);
  });
});
