/**
 * Template da agenda ao contato com conversa e mensagem reais (F70-S25).
 *
 * Antes o lembrete (e a ação de vencimento `send_message`) ia para a outbox com
 * `conversationId: ''` e um `messageId` sintético sem linha em `messages`. O worker outbound
 * recusa `conversationId` vazio (`parseOutboundJob`), então todo lembrete ia para a DLQ e
 * nunca chegava ao contato. Agora, na transação de quem chama (a mesma que reivindica a
 * marca de idempotência do evento), este módulo:
 *
 * 1. resolve a conversa WhatsApp do contato, nesta ordem:
 *    - a conversa do próprio evento (`events.conversation_id`), se é do contato e o canal
 *      dela é WhatsApp Cloud ativo (e, quando a ação fixa um canal, é esse canal);
 *    - o canal da ação (`send_message.channelId`) ou o WhatsApp default ativo do workspace,
 *      e nele a conversa mais recente do contato, depois a do par (canal, telefone);
 *    - sem nenhuma, CRIA a conversa (upsert pelo índice único canal + remote_id, a mesma
 *      corrida que o inbound e as campanhas tratam);
 * 2. grava a mensagem `pending` (`template`, remetente `system`);
 * 3. grava o job de envio e, quando criou a conversa, o `conversation.opened`
 *    (`trigger: calendar_reminder`) na outbox.
 *
 * Sem WhatsApp elegível ou sem telefone para abrir uma conversa, nada é gravado e o
 * motivo volta para quem chama registrar.
 *
 * **IA (trava de origem, F70-S07/S08/S19):** resolver ou criar a conversa não liga a IA.
 * A conversa existente fica como está (nenhuma coluna de IA é tocada). A conversa criada
 * aqui nasce `ai_mode = 'off'` e `origin = 'sem-origem'`:
 * - nada comprova de onde o contato veio: ele está na agenda da empresa, não chegou por
 *   anúncio, site ou Direct. `origem:prospeccao` também não serve — marca a conversa que o
 *   dono conduz pelo app, e o lembrete é automático;
 * - `sem-origem` é o valor fail-closed explícito: nenhum caminho automático liga a IA nela,
 *   e o worker de agentes não responde sem a marca humana (`ai_enabled_at`). Se o contato
 *   responder, o inbound acha a conversa pronta e não reclassifica (a origem é decidida uma
 *   vez, na criação); um humano liga a IA à mão se quiser.
 *
 * O contato NÃO ganha a etiqueta `sem-origem`: ela é do contato inteiro, e ele pode já ter
 * uma origem comprovada em outra conversa. A coluna da conversa registra o fato.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { enqueueOutbox, schema, type DbTx } from '@hm/db';
import {
  domainEvents,
  domainEventsOutbox,
  makeEnvelope,
  queueJobOutbox,
  QUEUES,
} from '@hm/shared/mq';
import { UNPROVEN_CONVERSATION_ORIGIN, type ConversationOriginValue } from '@hm/shared';

const { channels, contacts, conversations, messages } = schema;

/** Tipo do envelope do job de envio (o mesmo de toda a pipeline F1-S07). */
export const REMINDER_OUTBOUND_JOB_TYPE = 'outbound.request' as const;

/** Origem da conversa que o lembrete cria (ver doc do módulo). */
export const REMINDER_CONVERSATION_ORIGIN: ConversationOriginValue = UNPROVEN_CONVERSATION_ORIGIN;

/** Por que o template não foi gravado. */
export type ReminderSkipReason = 'no_whatsapp_channel' | 'no_phone';

export interface ContactTemplateInput {
  readonly workspaceId: string;
  readonly contactId: string;
  /** Conversa ligada ao evento (`events.conversation_id`), preferida quando serve. */
  readonly eventConversationId: string | null;
  /** Canal escolhido pela ação (`send_message.channelId`). Ausente = WhatsApp default. */
  readonly channelId?: string;
  readonly templateName: string;
  readonly languageCode: string;
  /** Vai em `messages.metadata` (rastro: evento, offset, ação). */
  readonly metadata: Record<string, unknown>;
}

export type ContactTemplateResult =
  | {
      readonly queued: true;
      readonly conversationId: string;
      readonly messageId: string;
      readonly channelId: string;
      /** `true` quando esta transação criou a conversa. */
      readonly conversationCreated: boolean;
    }
  | { readonly queued: false; readonly reason: ReminderSkipReason };

interface ResolvedConversation {
  readonly conversationId: string;
  readonly channelId: string;
  /** Id do contato no provider (WA: telefone) — o `chatId` do job. */
  readonly remoteId: string;
  readonly created: boolean;
}

/** Canal WhatsApp Cloud ativo: o pedido, ou o default do workspace (RLS). */
async function whatsappChannel(tx: DbTx, channelId: string | undefined): Promise<string | null> {
  const [row] = await tx
    .select({ id: channels.id })
    .from(channels)
    .where(
      and(
        eq(channels.provider, 'meta_whatsapp'),
        eq(channels.isActive, true),
        channelId !== undefined ? eq(channels.id, channelId) : eq(channels.isDefault, true),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** A conversa do evento, se é do contato, WhatsApp Cloud ativo e (se pedido) do canal. */
async function eventConversation(
  tx: DbTx,
  input: ContactTemplateInput,
): Promise<ResolvedConversation | null> {
  if (input.eventConversationId === null) return null;
  const [row] = await tx
    .select({
      id: conversations.id,
      channelId: conversations.channelId,
      remoteId: conversations.remoteId,
    })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(
      and(
        eq(conversations.id, input.eventConversationId),
        eq(conversations.contactId, input.contactId),
        eq(channels.provider, 'meta_whatsapp'),
        eq(channels.isActive, true),
        ...(input.channelId !== undefined ? [eq(conversations.channelId, input.channelId)] : []),
      ),
    )
    .limit(1);
  return row === undefined
    ? null
    : { conversationId: row.id, channelId: row.channelId, remoteId: row.remoteId, created: false };
}

/** Conversa do contato no canal: a mais recente dele, ou a do par (canal, telefone). */
async function conversationOnChannel(
  tx: DbTx,
  channelId: string,
  contactId: string,
  phone: string | null,
): Promise<ResolvedConversation | null> {
  const [byContact] = await tx
    .select({ id: conversations.id, remoteId: conversations.remoteId })
    .from(conversations)
    .where(and(eq(conversations.channelId, channelId), eq(conversations.contactId, contactId)))
    .orderBy(sql`${conversations.lastMessageAt} desc nulls last`, desc(conversations.createdAt))
    .limit(1);
  if (byContact !== undefined) {
    return {
      conversationId: byContact.id,
      channelId,
      remoteId: byContact.remoteId,
      created: false,
    };
  }
  if (phone === null) return null;
  const [byRemote] = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.channelId, channelId), eq(conversations.remoteId, phone)))
    .limit(1);
  return byRemote === undefined
    ? null
    : { conversationId: byRemote.id, channelId, remoteId: phone, created: false };
}

/**
 * Cria a conversa (IA desligada, `sem-origem`). O inbound ou uma campanha podem criar a
 * mesma conversa ao mesmo tempo: o `ON CONFLICT` no índice único absorve e relemos a
 * vencedora, que fica como está.
 */
async function createConversation(
  tx: DbTx,
  workspaceId: string,
  channelId: string,
  contactId: string,
  phone: string,
): Promise<ResolvedConversation> {
  const [created] = await tx
    .insert(conversations)
    .values({
      workspaceId,
      channelId,
      contactId,
      remoteId: phone,
      status: 'open',
      aiMode: 'off',
      origin: REMINDER_CONVERSATION_ORIGIN,
    })
    .onConflictDoNothing({ target: [conversations.channelId, conversations.remoteId] })
    .returning({ id: conversations.id });
  if (created !== undefined) {
    return { conversationId: created.id, channelId, remoteId: phone, created: true };
  }
  const [winner] = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.channelId, channelId), eq(conversations.remoteId, phone)))
    .limit(1);
  if (winner === undefined) {
    throw new Error('calendar-reminders: conversa não materializou após o upsert.');
  }
  return { conversationId: winner.id, channelId, remoteId: phone, created: false };
}

async function contactPhone(tx: DbTx, contactId: string): Promise<string | null> {
  const [row] = await tx
    .select({ phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  const phone = row?.phone ?? null;
  return phone !== null && phone.trim().length > 0 ? phone : null;
}

/**
 * Resolve (ou cria) a conversa, grava a mensagem `pending` e o job de envio na transação
 * `tx` (ver doc do módulo). Quem chama já reivindicou a marca de idempotência nela.
 */
export async function queueContactTemplate(
  tx: DbTx,
  input: ContactTemplateInput,
): Promise<ContactTemplateResult> {
  let conversation = await eventConversation(tx, input);
  if (conversation === null) {
    const channelId = await whatsappChannel(tx, input.channelId);
    if (channelId === null) return { queued: false, reason: 'no_whatsapp_channel' };
    const phone = await contactPhone(tx, input.contactId);
    conversation = await conversationOnChannel(tx, channelId, input.contactId, phone);
    if (conversation === null) {
      if (phone === null) return { queued: false, reason: 'no_phone' };
      conversation = await createConversation(
        tx,
        input.workspaceId,
        channelId,
        input.contactId,
        phone,
      );
    }
  }

  const [message] = await tx
    .insert(messages)
    .values({
      workspaceId: input.workspaceId,
      conversationId: conversation.conversationId,
      direction: 'outbound',
      senderType: 'system',
      type: 'template',
      content: input.templateName,
      viewStatus: 'pending',
      metadata: { ...input.metadata, templateName: input.templateName },
    })
    .returning({ id: messages.id });
  if (message === undefined) {
    throw new Error('calendar-reminders: mensagem do lembrete não materializou.');
  }

  const job = {
    kind: 'template' as const,
    channelId: conversation.channelId,
    conversationId: conversation.conversationId,
    messageId: message.id,
    chatId: conversation.remoteId,
    templateName: input.templateName,
    languageCode: input.languageCode,
    components: [],
  };
  await enqueueOutbox(tx, [
    ...(conversation.created
      ? domainEventsOutbox([
          domainEvents.conversationOpened(input.workspaceId, {
            conversationId: conversation.conversationId,
            contactId: input.contactId,
            channelId: conversation.channelId,
            trigger: 'calendar_reminder',
          }),
        ])
      : []),
    queueJobOutbox(
      QUEUES.outbound,
      makeEnvelope(REMINDER_OUTBOUND_JOB_TYPE, input.workspaceId, job),
    ),
  ]);

  return {
    queued: true,
    conversationId: conversation.conversationId,
    messageId: message.id,
    channelId: conversation.channelId,
    conversationCreated: conversation.created,
  };
}
