/**
 * Semeadura dos testes de integração das ações externas (F73-S09) contra o Postgres de dev.
 * Não é arquivo de teste (sem `.test.ts`): só é importado por eles.
 *
 * Monta um workspace com um membro por papel (`seedCopilotWorkspace`), canal WhatsApp oficial,
 * contatos com conversa (e última mensagem do contato numa idade controlada, para a janela de
 * 24 h), modelos do catálogo, agenda/compromissos, campanhas e flows. Nenhum envio real: o
 * limite do teste é a outbox.
 *
 * A limpeza apaga primeiro o que tem FK `restrict` (campanhas → canal; execuções → versão do
 * flow) e as linhas da outbox do workspace; o resto cai em cascata a partir do workspace.
 */
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';
import {
  seedCopilotWorkspace,
  type SeededWorkspace,
} from '../../../services/copilot/identity/test-fixtures';

function one<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`seed: falha ao criar ${what}`);
  return row;
}

export interface ExternalSeed {
  readonly ws: SeededWorkspace;
  readonly workspaceId: string;
  readonly channelId: string;
  readonly igChannelId: string;
  readonly calendarId: string;
  cleanup(): Promise<void>;
}

export async function seedExternalWorkspace(
  options: { readonly label?: string; readonly market?: 'BR' | 'US' } = {},
): Promise<ExternalSeed> {
  const ws = await seedCopilotWorkspace({ label: options.label ?? 'ActExt' });
  const db = getDb();
  if (options.market) {
    await db
      .update(schema.workspaces)
      .set({ market: options.market })
      .where(eq(schema.workspaces.id, ws.workspaceId));
  }
  const sfx = randomUUID().slice(0, 8);
  const channel = one(
    await db
      .insert(schema.channels)
      .values({
        workspaceId: ws.workspaceId,
        provider: 'meta_whatsapp',
        name: `WA ${sfx}`,
        phoneNumberId: `pn-s09-${sfx}`,
        wabaId: `waba-s09-${sfx}`,
      })
      .returning(),
    'canal',
  );
  const ig = one(
    await db
      .insert(schema.channels)
      .values({
        workspaceId: ws.workspaceId,
        provider: 'meta_instagram',
        name: `IG ${sfx}`,
        igUserId: `ig-s09-${sfx}`,
        fbPageId: `fb-s09-${sfx}`,
      })
      .returning(),
    'canal ig',
  );
  const calendar = one(
    await db
      .insert(schema.calendars)
      .values({
        workspaceId: ws.workspaceId,
        name: `Agenda ${sfx}`,
        type: 'workspace',
        ownerId: ws.members.OWNER.id,
      })
      .returning(),
    'agenda',
  );
  const workspaceId = ws.workspaceId;
  return {
    ws,
    workspaceId,
    channelId: channel.id,
    igChannelId: ig.id,
    calendarId: calendar.id,
    async cleanup() {
      const d = getDb();
      await d.delete(schema.campaigns).where(eq(schema.campaigns.workspaceId, workspaceId));
      await d
        .delete(schema.flowExecutions)
        .where(eq(schema.flowExecutions.workspaceId, workspaceId));
      await d.delete(schema.events).where(eq(schema.events.workspaceId, workspaceId));
      await d.delete(schema.outbox).where(eq(schema.outbox.workspaceId, workspaceId));
      await ws.cleanup();
    },
  };
}

export interface SeededRecipient {
  readonly contactId: string;
  readonly conversationId: string;
}

/**
 * Contato com uma conversa no canal. `lastInboundMinutesAgo`: idade da última mensagem DO
 * CONTATO (`null` = o contato nunca escreveu). 60 = janela aberta; 26 * 60 = fechada.
 */
export async function addRecipient(
  seed: ExternalSeed,
  input: {
    readonly name: string | null;
    readonly channelId?: string;
    readonly lastInboundMinutesAgo?: number | null;
    readonly timezone?: string | null;
    /** Responsável pela conversa (SUPERVISOR/AGENT só veem o que é deles ou do depto). */
    readonly assignedTo?: string | null;
  },
): Promise<SeededRecipient> {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const contact = one(
    await db
      .insert(schema.contacts)
      .values({
        workspaceId: seed.workspaceId,
        displayName: input.name,
        phone: `+55119${Math.floor(Math.random() * 1e8)
          .toString()
          .padStart(8, '0')}`,
        timezone: input.timezone ?? null,
      })
      .returning(),
    'contato',
  );
  const conversation = one(
    await db
      .insert(schema.conversations)
      .values({
        workspaceId: seed.workspaceId,
        channelId: input.channelId ?? seed.channelId,
        contactId: contact.id,
        remoteId: `r-${sfx}`,
        lastMessageAt: new Date(),
        assignedTo: input.assignedTo ?? null,
      })
      .returning(),
    'conversa',
  );
  const ago = input.lastInboundMinutesAgo === undefined ? 60 : input.lastInboundMinutesAgo;
  if (ago !== null) {
    await db.insert(schema.messages).values({
      workspaceId: seed.workspaceId,
      conversationId: conversation.id,
      direction: 'inbound',
      senderType: 'contact',
      type: 'text',
      content: 'Oi',
      viewStatus: 'delivered',
      createdAt: new Date(Date.now() - ago * 60_000),
    });
  }
  return { contactId: contact.id, conversationId: conversation.id };
}

export async function addTemplate(
  seed: ExternalSeed,
  input: {
    readonly name: string;
    readonly body: string;
    readonly status?: string;
    readonly category?: string;
    readonly channelId?: string;
  },
): Promise<string> {
  const row = one(
    await getDb()
      .insert(schema.channelMessageTemplates)
      .values({
        workspaceId: seed.workspaceId,
        channelId: input.channelId ?? seed.channelId,
        externalId: `tpl-${randomUUID().slice(0, 8)}`,
        name: input.name,
        language: 'pt_BR',
        category: input.category ?? 'UTILITY',
        status: input.status ?? 'APPROVED',
        components: [{ type: 'BODY', text: input.body }],
      })
      .returning(),
    'modelo',
  );
  return row.id;
}

export async function addEvent(
  seed: ExternalSeed,
  input: {
    readonly contactId: string;
    readonly startAt: Date;
    readonly title: string;
    readonly conversationId?: string;
  },
): Promise<string> {
  const row = one(
    await getDb()
      .insert(schema.events)
      .values({
        workspaceId: seed.workspaceId,
        calendarId: seed.calendarId,
        title: input.title,
        startAt: input.startAt,
        endAt: new Date(input.startAt.getTime() + 30 * 60_000),
        contactId: input.contactId,
        conversationId: input.conversationId ?? null,
        createdBy: seed.ws.members.OWNER.id,
      })
      .returning(),
    'compromisso',
  );
  return row.id;
}

export interface SeededCampaign {
  readonly campaignId: string;
  readonly recipientIds: string[];
}

/**
 * Campanha com `sent` destinatários que já receberam (entrega `sent`) e `pending` que ainda
 * iam receber.
 */
export async function addCampaign(
  seed: ExternalSeed,
  input: {
    readonly status: string;
    readonly sent?: number;
    readonly pending?: number;
    readonly name?: string;
  },
): Promise<SeededCampaign> {
  const db = getDb();
  const campaign = one(
    await db
      .insert(schema.campaigns)
      .values({
        workspaceId: seed.workspaceId,
        channelId: seed.channelId,
        name: input.name ?? `Campanha ${randomUUID().slice(0, 6)}`,
        type: 'broadcast',
        status: input.status,
      })
      .returning(),
    'campanha',
  );
  const step = one(
    await db
      .insert(schema.campaignSteps)
      .values({ campaignId: campaign.id, position: 0, templateName: 'promo' })
      .returning(),
    'passo',
  );
  const recipientIds: string[] = [];
  const total = (input.sent ?? 0) + (input.pending ?? 0);
  for (let i = 0; i < total; i++) {
    const r = await addRecipient(seed, { name: `Destinatário ${i}` });
    const isSent = i < (input.sent ?? 0);
    const recipient = one(
      await db
        .insert(schema.campaignRecipients)
        .values({
          workspaceId: seed.workspaceId,
          campaignId: campaign.id,
          contactId: r.contactId,
          status: isSent ? 'completed' : 'pending',
        })
        .returning(),
      'destinatário',
    );
    recipientIds.push(recipient.id);
    if (isSent) {
      await db.insert(schema.campaignDeliveries).values({
        workspaceId: seed.workspaceId,
        campaignId: campaign.id,
        recipientId: recipient.id,
        stepId: step.id,
        status: 'sent',
        idempotencyKey: `s09-${randomUUID()}`,
        sentAt: new Date(),
      });
    }
  }
  return { campaignId: campaign.id, recipientIds };
}

export async function campaignStatus(campaignId: string): Promise<string | undefined> {
  const [row] = await getDb()
    .select({ status: schema.campaigns.status })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId));
  return row?.status;
}

export async function addFlow(
  seed: ExternalSeed,
  input: { readonly status?: string; readonly sends?: boolean; readonly published?: boolean },
): Promise<string> {
  const db = getDb();
  const nodes = [
    { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: {} },
    ...(input.sends === false
      ? [{ id: 'tag', type: 'add_tag', position: { x: 0, y: 100 }, data: { tagId: randomUUID() } }]
      : [{ id: 'msg', type: 'message', position: { x: 0, y: 100 }, data: { text: 'Olá!' } }]),
  ];
  const flow = one(
    await db
      .insert(schema.flows)
      .values({
        workspaceId: seed.workspaceId,
        name: `Flow ${randomUUID().slice(0, 6)}`,
        triggerType: 'manual',
        status: input.status ?? 'active',
        nodes,
      })
      .returning(),
    'flow',
  );
  if (input.published !== false) {
    await db.insert(schema.flowVersions).values({
      flowId: flow.id,
      version: 1,
      nodes,
      edges: [{ id: 'e1', source: 'trigger', target: nodes[1]?.id ?? 'msg' }],
      triggerConfig: {},
    });
  }
  return flow.id;
}

/** Linhas da outbox (jobs) que apontam as mensagens dadas. */
export async function outboxPayloadsFor(
  workspaceId: string,
  messageIds: readonly string[],
): Promise<Record<string, unknown>[]> {
  if (messageIds.length === 0) return [];
  const rows = await getDb()
    .select({ envelope: schema.outbox.envelope })
    .from(schema.outbox)
    .where(eq(schema.outbox.workspaceId, workspaceId));
  const wanted = new Set(messageIds);
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    const env = r.envelope as { payload?: Record<string, unknown> };
    const id = env.payload?.['messageId'];
    if (typeof id === 'string' && wanted.has(id) && env.payload) out.push(env.payload);
  }
  return out;
}

/** Mensagens outbound gravadas na conversa. */
export async function outboundMessages(conversationIds: readonly string[]) {
  if (conversationIds.length === 0) return [];
  return getDb()
    .select()
    .from(schema.messages)
    .where(inArray(schema.messages.conversationId, [...conversationIds]))
    .then((rows) => rows.filter((r) => r.direction === 'outbound'));
}
