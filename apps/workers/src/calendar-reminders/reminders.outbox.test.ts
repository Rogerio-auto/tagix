/**
 * Lembretes da agenda ao contato, pela outbox, com conversa e mensagem reais (Postgres dev,
 * RLS real do `withWorkspace`).
 *
 * F70-S21: o job WhatsApp entra na outbox junto da marca de idempotência que o motiva.
 * F70-S25: o job leva conversa e mensagem `pending` REAIS — antes ia com
 * `conversationId: ''` e um `messageId` sem linha, e o worker outbound o recusava (DLQ):
 *  - sem conversa: cria (IA desligada, `sem-origem`) e anuncia `conversation.opened`;
 *  - com conversa do contato: usa a dela, sem tocar em IA nem origem;
 *  - a conversa do evento tem prioridade, se for WhatsApp ativo;
 *  - o job é aceito e enviado pelo worker outbound (portas reais de banco, adapter fake);
 *  - sem WhatsApp elegível (ou sem telefone para abrir conversa): nada é gravado além da
 *    marca, e o motivo fica auditado;
 *  - rollback forçado depois de todo o trabalho, antes do COMMIT: nada fica.
 *
 * A outbox é lida por outra conexão (`../outbox/testing`): linha visível = commitada.
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Db from '@hm/db';
import type { Channel, IChannelAdapter, SendResult } from '@hm/channels';
import { createLogger } from '@hm/logger';
import type { DueReminder, ReminderDbDeps } from './reminders';

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
const { isConversationAiEligible } = await import('@hm/flow-engine');
const { outboxRowsOf, eventOf } = await import('../outbox/testing');
const { parseOutboundJob } = await import('../outbound/job');
const { handleOutboundEnvelope } = await import('../outbound/worker');
const { allowAllConsentGate } = await import('../outbound/consent-gate');
const { allowAllSubscriptionGate } = await import('../lib/subscription-gate');
const { DbOutboundPersistence } = await import('../outbound/db-ports');
const { createReminderPorts, REMINDER_TEMPLATE_NAME } = await import('./reminders');
const { REMINDER_CONVERSATION_ORIGIN } = await import('./contact-conversation');

const ready = Boolean(process.env['DATABASE_URL']);
const WS = randomUUID();
/** WhatsApp default ativo do workspace. */
const CHANNEL = randomUUID();
/** Segundo WhatsApp ativo (não default): o da conversa do evento. */
const CHANNEL_2 = randomUUID();
/** Instagram ativo: não serve para template. */
const IG_CHANNEL = randomUUID();
const CALENDAR = randomUUID();
/** Workspace sem nenhum WhatsApp ativo. */
const WS_NO_WA = randomUUID();
const CALENDAR_NO_WA = randomUUID();

// O relay de socket e a engine de flows não entram nestes caminhos.
const channel = {
  sendToQueue: () => true,
  publish: () => true,
} as unknown as ReminderDbDeps['channel'];
const ports = createReminderPorts({ channel, logger: createLogger('error') });

let seq = 0;
function phone(): string {
  seq += 1;
  return `+55119${String(Date.now() % 1e6).padStart(6, '0')}${String(seq).padStart(2, '0')}`;
}

async function newContact(
  workspaceId = WS,
  withPhone = true,
): Promise<{ id: string; phone: string | null }> {
  const p = withPhone ? phone() : null;
  const [row] = await getDb()
    .insert(schema.contacts)
    .values({ workspaceId, phone: p })
    .returning({ id: schema.contacts.id });
  if (!row) throw new Error('fixture: contato');
  return { id: row.id, phone: p };
}

async function newEvent(
  contactId: string,
  workspaceId = WS,
  calendarId = CALENDAR,
): Promise<string> {
  const startAt = new Date(Date.now() - 60_000);
  const [row] = await getDb()
    .insert(schema.events)
    .values({
      workspaceId,
      calendarId,
      title: 'Reunião F70-S25',
      startAt,
      endAt: new Date(startAt.getTime() + 30 * 60_000),
      contactId,
    })
    .returning({ id: schema.events.id });
  if (!row) throw new Error('fixture: evento');
  return row.id;
}

function reminderOf(
  eventId: string,
  contactId: string,
  over: Partial<DueReminder> = {},
): DueReminder {
  return {
    eventId,
    workspaceId: WS,
    calendarId: CALENDAR,
    title: 'Reunião F70-S25',
    startAt: new Date(Date.now() - 60_000),
    type: 'meeting',
    priority: 'medium',
    contactId,
    dealId: null,
    conversationId: null,
    remindersSent: [],
    dueAction: { kind: 'send_message', templateName: 'lembrete_f70s25', languageCode: 'pt_BR' },
    dueActionDone: false,
    ...over,
  };
}

async function metadataOf(eventId: string): Promise<Record<string, unknown>> {
  const [row] = await getDb()
    .select({ metadata: schema.events.metadata })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  return (row?.metadata ?? {}) as Record<string, unknown>;
}

async function conversationsOf(contactId: string) {
  return getDb()
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.contactId, contactId));
}

async function messagesOf(conversationId: string) {
  return getDb()
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId));
}

/** Jobs de envio da outbox cuja mensagem é de uma das conversas dadas. */
async function jobsFor(conversationIds: readonly string[], workspaceId = WS) {
  return (await outboxRowsOf(workspaceId)).filter(
    (r) =>
      r.routingKey === 'hm.q.outbound' &&
      conversationIds.includes(
        String((r.envelope.payload as Record<string, unknown>)['conversationId']),
      ),
  );
}

async function openedFor(conversationId: string) {
  return (await outboxRowsOf(WS))
    .filter((r) => r.kind === 'event')
    .map(eventOf)
    .filter(
      (e) => e.event === 'conversation.opened' && e.data['conversationId'] === conversationId,
    );
}

async function auditOf(eventId: string) {
  return getDb()
    .select({ action: schema.auditLogs.action, metadata: schema.auditLogs.metadata })
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.resourceId, eventId));
}

async function insertConversation(values: {
  channelId: string;
  contactId: string;
  remoteId: string;
  aiMode?: string;
  origin?: 'origem:anuncio' | null;
}): Promise<string> {
  const [row] = await getDb()
    .insert(schema.conversations)
    .values({ workspaceId: WS, ...values })
    .returning({ id: schema.conversations.id });
  if (!row) throw new Error('fixture: conversa');
  return row.id;
}

beforeAll(async () => {
  if (!ready) return;
  const db = getDb();
  const sfx = WS.slice(0, 8);
  await db.insert(schema.workspaces).values([
    { id: WS, name: 'F70-S25 lembretes', slug: `f70s25-cal-${sfx}` },
    { id: WS_NO_WA, name: 'F70-S25 sem WA', slug: `f70s25-nowa-${sfx}` },
  ]);
  await db.insert(schema.channels).values([
    {
      id: CHANNEL,
      workspaceId: WS,
      provider: 'meta_whatsapp',
      name: 'WA default F70-S25',
      phoneNumberId: `pn-f70s25-${CHANNEL.slice(0, 8)}`,
      wabaId: `waba-f70s25-${CHANNEL.slice(0, 8)}`,
      isActive: true,
      isDefault: true,
    },
    {
      id: CHANNEL_2,
      workspaceId: WS,
      provider: 'meta_whatsapp',
      name: 'WA 2 F70-S25',
      phoneNumberId: `pn-f70s25-${CHANNEL_2.slice(0, 8)}`,
      wabaId: `waba-f70s25-${CHANNEL_2.slice(0, 8)}`,
      isActive: true,
      isDefault: false,
    },
    {
      id: IG_CHANNEL,
      workspaceId: WS,
      provider: 'meta_instagram',
      name: 'IG F70-S25',
      igUserId: `ig-f70s25-${IG_CHANNEL.slice(0, 8)}`,
      fbPageId: `fb-f70s25-${IG_CHANNEL.slice(0, 8)}`,
      isActive: true,
    },
    // O único WhatsApp do outro workspace está desativado.
    {
      workspaceId: WS_NO_WA,
      provider: 'meta_whatsapp',
      name: 'WA inativo F70-S25',
      phoneNumberId: `pn-f70s25-off-${sfx}`,
      wabaId: `waba-f70s25-off-${sfx}`,
      isActive: false,
      isDefault: true,
    },
  ]);
  await db.insert(schema.calendars).values([
    { id: CALENDAR, workspaceId: WS, name: 'Agenda F70-S25', type: 'workspace' },
    { id: CALENDAR_NO_WA, workspaceId: WS_NO_WA, name: 'Agenda F70-S25 b', type: 'workspace' },
  ]);
});

afterEach(() => {
  rollback.armed = false;
});

afterAll(async () => {
  rollback.armed = false;
  if (ready) {
    for (const id of [WS, WS_NO_WA]) {
      await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, id));
    }
  }
  await closeDb();
});

// ─── Worker outbound (portas reais de banco, adapter fake) ────────────────────

function templateAdapter(): IChannelAdapter & { sendTemplate: ReturnType<typeof vi.fn> } {
  const ok: SendResult = { ok: true, externalId: `wamid.f70s25.${randomUUID()}` };
  const sendTemplate = vi.fn(async () => ok);
  const unused = vi.fn(async () => ({ ok: false, errorCode: 'unused' }) as SendResult);
  return {
    provider: 'meta_whatsapp',
    capabilities: {
      templatesHSM: true,
      storyMentions: false,
      storyReplies: false,
      publicComments: false,
      messageTags: false,
      voicePtt: true,
      sticker: true,
      location: true,
    },
    parseInbound: vi.fn(async () => []),
    sendText: unused,
    sendMedia: unused,
    sendTemplate,
    sendInteractive: unused,
    downloadMedia: vi.fn(async () => Buffer.alloc(0)),
    markAsRead: vi.fn(async () => undefined),
    sendTypingIndicator: vi.fn(async () => undefined),
  };
}

async function deliverThroughOutbound(
  row: Awaited<ReturnType<typeof jobsFor>>[number],
  adapter: IChannelAdapter,
): Promise<void> {
  const snapshot: Channel = {
    id: CHANNEL,
    workspaceId: WS,
    provider: 'meta_whatsapp',
    accessToken: 'tok',
    phoneNumberId: 'pn',
  };
  await handleOutboundEnvelope(row.envelope, {
    deps: {
      channels: { resolve: async () => ({ channel: snapshot, adapter }) },
      persistence: new DbOutboundPersistence(),
      socket: { emitStatusChanged: async () => undefined, emitMessageNew: async () => undefined },
    },
    logger: createLogger('error'),
    consentGate: allowAllConsentGate,
        subscriptionGate: allowAllSubscriptionGate,
  });
}

// ─── Lembrete ao contato ───────────────────────────────────────────────────────

describe.skipIf(!ready)('lembrete ao contato com conversa real (F70-S25)', () => {
  it('sem conversa: cria (IA off, sem-origem), grava mensagem e job; o outbound aceita e envia', async () => {
    const contact = await newContact();
    const eventId = await newEvent(contact.id);

    expect(await ports.sendContactReminder(reminderOf(eventId, contact.id), 60)).toBe(true);
    expect((await metadataOf(eventId))['remindersSent']).toEqual([60]);

    // A conversa nasceu no WhatsApp default, com a IA desligada e sem origem comprovada.
    const convs = await conversationsOf(contact.id);
    expect(convs).toHaveLength(1);
    const conv = convs[0];
    expect(conv).toMatchObject({
      channelId: CHANNEL,
      remoteId: contact.phone,
      aiMode: 'off',
      origin: REMINDER_CONVERSATION_ORIGIN,
      aiEnabledAt: null,
    });
    expect(REMINDER_CONVERSATION_ORIGIN).toBe('sem-origem');
    expect(isConversationAiEligible(conv?.origin)).toBe(false);
    expect(await openedFor(conv?.id ?? '')).toEqual([
      expect.objectContaining({
        data: {
          conversationId: conv?.id,
          contactId: contact.id,
          channelId: CHANNEL,
          trigger: 'calendar_reminder',
        },
      }),
    ]);

    // Mensagem pending real, e UM job que aponta para ela.
    const msgs = await messagesOf(conv?.id ?? '');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      direction: 'outbound',
      senderType: 'system',
      type: 'template',
      content: REMINDER_TEMPLATE_NAME,
      viewStatus: 'pending',
    });
    const jobs = await jobsFor([conv?.id ?? '']);
    expect(jobs).toHaveLength(1);
    const job = parseOutboundJob(jobs[0]?.envelope.payload);
    expect(job).toMatchObject({
      kind: 'template',
      channelId: CHANNEL,
      conversationId: conv?.id,
      messageId: msgs[0]?.id,
      chatId: contact.phone,
      templateName: REMINDER_TEMPLATE_NAME,
    });

    // O worker outbound aceita (sem DLQ) e envia: a mensagem vira `sent`.
    const adapter = templateAdapter();
    const first = jobs[0];
    if (first === undefined) throw new Error('job ausente');
    await expect(deliverThroughOutbound(first, adapter)).resolves.toBeUndefined();
    expect(adapter.sendTemplate).toHaveBeenCalledTimes(1);
    const [sent] = await messagesOf(conv?.id ?? '');
    expect(sent?.viewStatus).toBe('sent');
    expect(sent?.externalId).toMatch(/^wamid\.f70s25\./);

    // A IA continua desligada depois do envio.
    const [after] = await conversationsOf(contact.id);
    expect(after?.aiMode).toBe('off');

    // Outro tick com o snapshot antigo: a marca barra; nem job nem mensagem novos.
    expect(await ports.sendContactReminder(reminderOf(eventId, contact.id), 60)).toBe(false);
    expect(await jobsFor([conv?.id ?? ''])).toHaveLength(1);
    expect(await messagesOf(conv?.id ?? '')).toHaveLength(1);
  });

  it('com conversa do contato: usa a dela (remote_id do provider) sem tocar em IA nem origem', async () => {
    const contact = await newContact();
    const remoteId = (contact.phone ?? '').replace('+', '');
    const existing = await insertConversation({
      channelId: CHANNEL,
      contactId: contact.id,
      remoteId,
      aiMode: 'off',
      origin: null,
    });
    const eventId = await newEvent(contact.id);

    expect(await ports.sendContactReminder(reminderOf(eventId, contact.id), 1440)).toBe(true);

    const convs = await conversationsOf(contact.id);
    expect(convs).toHaveLength(1);
    expect(convs[0]).toMatchObject({ id: existing, aiMode: 'off', origin: null });
    expect(await openedFor(existing)).toHaveLength(0);
    const jobs = await jobsFor([existing]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.envelope.payload).toMatchObject({ conversationId: existing, chatId: remoteId });
  });

  it('a conversa do evento tem prioridade quando é WhatsApp ativo', async () => {
    const contact = await newContact();
    const onDefault = await insertConversation({
      channelId: CHANNEL,
      contactId: contact.id,
      remoteId: `d-${contact.id.slice(0, 8)}`,
    });
    const ofEvent = await insertConversation({
      channelId: CHANNEL_2,
      contactId: contact.id,
      remoteId: `e-${contact.id.slice(0, 8)}`,
    });
    const eventId = await newEvent(contact.id);

    expect(
      await ports.sendContactReminder(
        reminderOf(eventId, contact.id, { conversationId: ofEvent }),
        60,
      ),
    ).toBe(true);

    expect(await jobsFor([onDefault])).toHaveLength(0);
    const jobs = await jobsFor([ofEvent]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.envelope.payload).toMatchObject({
      channelId: CHANNEL_2,
      conversationId: ofEvent,
    });
  });

  it('sem WhatsApp elegível: não envia, grava a marca e audita o motivo', async () => {
    const contact = await newContact(WS_NO_WA);
    const eventId = await newEvent(contact.id, WS_NO_WA, CALENDAR_NO_WA);

    expect(
      await ports.sendContactReminder(
        reminderOf(eventId, contact.id, { workspaceId: WS_NO_WA, calendarId: CALENDAR_NO_WA }),
        60,
      ),
    ).toBe(false);

    expect((await metadataOf(eventId))['remindersSent']).toEqual([60]);
    expect(await conversationsOf(contact.id)).toHaveLength(0);
    expect((await outboxRowsOf(WS_NO_WA)).filter((r) => r.kind === 'job')).toHaveLength(0);
    expect(await auditOf(eventId)).toEqual([
      {
        action: 'event.reminder.contact_skipped',
        metadata: { offsetMin: 60, reason: 'no_whatsapp_channel' },
      },
    ]);
  });

  it('sem telefone e sem conversa: não envia e audita no_phone', async () => {
    const contact = await newContact(WS, false);
    const eventId = await newEvent(contact.id);

    expect(await ports.sendContactReminder(reminderOf(eventId, contact.id), 60)).toBe(false);
    expect(await conversationsOf(contact.id)).toHaveLength(0);
    expect(await auditOf(eventId)).toEqual([
      { action: 'event.reminder.contact_skipped', metadata: { offsetMin: 60, reason: 'no_phone' } },
    ]);
  });

  it('rollback: nem marca, nem conversa, nem mensagem, nem job', async () => {
    const contact = await newContact();
    const eventId = await newEvent(contact.id);
    rollback.armed = true;
    await expect(ports.sendContactReminder(reminderOf(eventId, contact.id), 1440)).rejects.toThrow(
      FORCED,
    );
    rollback.armed = false;

    expect((await metadataOf(eventId))['remindersSent']).toBeUndefined();
    // Sem conversa não há mensagem (FK) nem job que aponte para ela.
    expect(await conversationsOf(contact.id)).toHaveLength(0);
    const jobsOfContact = (await outboxRowsOf(WS)).filter(
      (r) => (r.envelope.payload as Record<string, unknown>)['chatId'] === contact.phone,
    );
    expect(jobsOfContact).toHaveLength(0);
    expect(await auditOf(eventId)).toHaveLength(0);
  });
});

describe.skipIf(!ready)('markReminded grava a marca do tick (F70-S21)', () => {
  // Regressão: o array de offsets ia como lista de parâmetros e a query falhava sempre.
  it('vários offsets de uma vez, sem repetir o que já estava', async () => {
    const contact = await newContact();
    const eventId = await newEvent(contact.id);
    expect(await ports.sendContactReminder(reminderOf(eventId, contact.id), 60)).toBe(true);
    await ports.markReminded(eventId, WS, [1440, 60, 0]);

    const sent = (await metadataOf(eventId))['remindersSent'];
    expect(Array.isArray(sent) ? [...sent].sort((a, b) => Number(a) - Number(b)) : sent).toEqual([
      0, 60, 1440,
    ]);
  });
});

describe.skipIf(!ready)('ação de vencimento send_message com conversa real (F70-S21/S25)', () => {
  it('commit: dueActionDone, mensagem e UM job aceitos pelo contrato; repetir não grava outro', async () => {
    const contact = await newContact();
    const eventId = await newEvent(contact.id);
    await ports.runDueAction(reminderOf(eventId, contact.id));

    expect((await metadataOf(eventId))['dueActionDone']).toBe(true);
    const [conv] = await conversationsOf(contact.id);
    expect(conv).toMatchObject({ channelId: CHANNEL, aiMode: 'off', origin: 'sem-origem' });
    const jobs = await jobsFor([conv?.id ?? '']);
    expect(jobs).toHaveLength(1);
    const [msg] = await messagesOf(conv?.id ?? '');
    expect(parseOutboundJob(jobs[0]?.envelope.payload)).toMatchObject({
      kind: 'template',
      conversationId: conv?.id,
      messageId: msg?.id,
      templateName: 'lembrete_f70s25',
      languageCode: 'pt_BR',
      chatId: contact.phone,
    });

    await ports.runDueAction(reminderOf(eventId, contact.id));
    expect(await jobsFor([conv?.id ?? ''])).toHaveLength(1);
  });

  it('canal da ação que não é WhatsApp: não envia e audita o motivo', async () => {
    const contact = await newContact();
    const eventId = await newEvent(contact.id);
    await ports.runDueAction(
      reminderOf(eventId, contact.id, {
        dueAction: {
          kind: 'send_message',
          templateName: 'lembrete_f70s25',
          languageCode: 'pt_BR',
          channelId: IG_CHANNEL,
        },
      }),
    );

    expect(await conversationsOf(contact.id)).toHaveLength(0);
    expect(await auditOf(eventId)).toEqual([
      expect.objectContaining({
        action: 'event.due_action.skipped',
        metadata: expect.objectContaining({ reason: 'no_whatsapp_channel' }),
      }),
    ]);
  });

  it('rollback: nem a marca nem conversa/job ficam (a falha sobe para o retry do tick)', async () => {
    const contact = await newContact();
    const eventId = await newEvent(contact.id);
    rollback.armed = true;
    await expect(ports.runDueAction(reminderOf(eventId, contact.id))).rejects.toThrow(FORCED);
    rollback.armed = false;

    expect((await metadataOf(eventId))['dueActionDone']).toBeUndefined();
    expect(await conversationsOf(contact.id)).toHaveLength(0);
  });
});
