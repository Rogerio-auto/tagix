/**
 * Envio de mensagem por um membro (F1-S24 / LIVECHAT.md §3; F73-S09).
 *
 * Um caminho só para a mensagem que sai em nome de uma pessoa da equipe:
 *
 *   `persistMemberOutbound` — o NÚCLEO do `POST /api/conversations/:id/messages`, extraído da
 *   rota sem mudar o comportamento: grava a mensagem `pending`, audita a tag IG, aplica a
 *   auto-pausa da IA no handoff humano (`planHumanReply`, F30-S04/F70-S07) e grava o job de
 *   envio na OUTBOX na mesma transação (F70-S21). A rota continua dona da validação do corpo,
 *   da visibilidade e da idempotência; o núcleo é o mesmo.
 *
 *   `enqueueMemberMessage` — o envio em nome do membro (Copiloto, ADR-003 §6): resolve a
 *   conversa sob a MESMA régua de visibilidade da inbox, confere o portão de consentimento
 *   (`checkOutboundInTx`) e a janela de 24 h do provider, e chama o núcleo. Mensagem já criada
 *   com a mesma chave de idempotência volta como `replay` (nenhum job novo). O consent gate do
 *   worker continua sendo a ÚLTIMA barreira: o job leva a mesma `purpose` usada aqui.
 *
 * Nada sai do processo aqui: o job vai para a outbox e o relay publica DEPOIS do commit. O
 * evento de socket da auto-pausa (`emitAiModeChanged`) é de quem chama, depois do commit.
 *
 * Mensagem agendada (`scheduledFor`): não há mecanismo de agendamento para mensagem individual
 * no produto (o agendamento existente é da campanha: `campaign_steps`/`scheduled_followups`,
 * amarrado a destinatário de campanha). Não inventamos um: pedido com `scheduledFor` no futuro
 * é recusado (`scheduling_unavailable`), nunca enviado na hora em silêncio.
 */
import { Buffer } from 'node:buffer';
import { and, desc, eq, sql } from 'drizzle-orm';
import { assertConversationVisible, schema, type DbTx } from '@hm/db';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import {
  CHANNEL_KINDS,
  planHumanReply,
  type AiMode,
  type ChannelKind,
  type ConversationAiModeChangedPayload,
  type MessagePurpose,
  type OutboundDenyReason,
  type Role,
} from '@hm/shared';
import { enqueueOutboundJob } from '../../mq/outbound-publisher';
import { checkOutboundInTx } from '../consent';
import { computeWindow, type WindowState } from '../../routes/conversations/window';
import {
  buildOutboundJob,
  type IgMessageTagValue,
  type OutboundTemplate,
  type ResolvedConversation,
} from './outbound-job';

type MessageRow = typeof schema.messages.$inferSelect;
type MessageInsert = typeof schema.messages.$inferInsert;

/** Colunas da mensagem que o chamador decide (o resto é do núcleo). */
export type MemberMessageValues = Omit<
  MessageInsert,
  | 'id'
  | 'workspaceId'
  | 'conversationId'
  | 'direction'
  | 'senderType'
  | 'senderMemberId'
  | 'viewStatus'
  | 'externalId'
>;

export interface PersistMemberOutboundInput {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly conversation: ResolvedConversation;
  readonly senderMemberId: string;
  readonly values: MemberMessageValues;
  /** Tag IG fora da janela: o envio com tag é ação auditável. */
  readonly messageTag?: IgMessageTagValue | null;
  /** Monta o job com o id da mensagem recém-criada. */
  readonly job: (messageId: string) => Record<string, unknown>;
}

export interface PersistedMemberOutbound {
  readonly message: MessageRow;
  /** A IA acabou de pausar por handoff humano (o chamador emite o evento após o commit). */
  readonly aiPausedByHandoff: boolean;
}

/**
 * Núcleo do envio do membro (mesma transação para mensagem, auto-pausa e job). `null` se o
 * INSERT não materializou (nunca acontece com constraints satisfeitas).
 */
export async function persistMemberOutbound(
  tx: DbTx,
  input: PersistMemberOutboundInput,
): Promise<PersistedMemberOutbound | null> {
  const { workspaceId, conversationId, senderMemberId } = input;
  const [message] = await tx
    .insert(schema.messages)
    .values({
      ...input.values,
      workspaceId,
      conversationId,
      direction: 'outbound',
      senderType: 'member',
      senderMemberId,
      viewStatus: 'pending',
      externalId: null,
    })
    .returning();
  if (!message) return null;

  // Envio com tag IG (fora da janela 24h) é ação auditável.
  if (input.messageTag != null) {
    await tx.insert(schema.auditLogs).values({
      workspaceId,
      actorMemberId: senderMemberId,
      actorType: 'member',
      action: 'message.send_with_tag',
      resourceType: 'message',
      resourceId: message.id,
      metadata: { messageTag: input.messageTag, conversationId },
    });
  }

  // F30-S04 — auto-pausa de IA ao humano responder (regra única em `@hm/shared`, F70-S07).
  // on → paused + human_takeover; paused/off só registram a atividade humana (nunca regridem).
  //
  // Não lê `first_response_at`/`ai_last_human_at` (não precisa de lock): passa `null` e deixa
  // o banco proteger a 1ª resposta com `coalesce` — só grava se ainda NULL (F55-S02), com
  // `now()` do servidor. `at = now` sempre avança `ai_last_human_at`.
  const now = new Date();
  const plan = planHumanReply(
    { aiMode: input.conversation.aiMode, firstResponseAt: null, aiLastHumanAt: null },
    { memberId: senderMemberId, at: now, countsAsResponse: true },
  );
  const { firstResponseAt: markFirstResponse, ...patch } = plan.patch;
  await tx
    .update(schema.conversations)
    .set({
      ...patch,
      ...(markFirstResponse !== undefined
        ? { firstResponseAt: sql`coalesce(${schema.conversations.firstResponseAt}, now())` }
        : {}),
      updatedAt: now,
    })
    .where(eq(schema.conversations.id, conversationId));

  // F70-S21 — o job de envio entra na outbox NESTA transação: commit da mensagem `pending` e
  // do job é o mesmo. Shape EXATO de `parseOutboundJob` (o worker valida).
  await enqueueOutboundJob(tx, workspaceId, input.job(message.id));

  return { message, aiPausedByHandoff: plan.paused };
}

// ── Relay AMQP do handoff (best-effort, mesma estratégia de state.ts) ─────────────

/** Fila de relay do socket (mesma constante de `apps/api/src/socket/relay.ts`). */
const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

/** Handle AMQP lazy singleton por processo. */
let mqHandlePromise: Promise<MqHandle> | null = null;

async function getMqHandle(): Promise<MqHandle> {
  mqHandlePromise ??= connectMq();
  try {
    return await mqHandlePromise;
  } catch (err) {
    mqHandlePromise = null;
    throw err;
  }
}

/**
 * Publica `conversation:ai_mode_changed` na fila de relay do socket. Chamar DEPOIS do commit.
 * Best-effort: quem chama silencia o erro — a persistência já está commitada.
 */
export async function emitAiModeChanged(
  workspaceId: string,
  conversationId: string,
  aiMode: AiMode,
): Promise<void> {
  const { channel } = await getMqHandle();
  const payload: ConversationAiModeChangedPayload = {
    conversationId,
    aiMode,
    reason: 'human_takeover',
  };
  const envelope = makeEnvelope('socket.relay', workspaceId, {
    event: 'conversation:ai_mode_changed' as const,
    target: { conversationId, workspace: true },
    data: payload,
  });
  channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
  await Promise.resolve();
}

// ── Envio em nome do membro (Copiloto) ───────────────────────────────────────────

/** Quem envia (o membro cujas permissões valem; ADR-003). */
export interface MemberActor {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly role: Role;
}

export type MemberMessageContent =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'template';
      /** Texto final renderizado (vai para `messages.content`, a bolha da timeline). */
      readonly renderedText: string;
      readonly template: OutboundTemplate;
    };

export interface EnqueueMemberMessageInput {
  readonly actor: MemberActor;
  /** Conversa alvo, ou o contato (resolve a conversa mais recente que o membro vê). */
  readonly target:
    | { readonly conversationId: string }
    | { readonly contactId: string; readonly channelId?: string };
  readonly content: MemberMessageContent;
  /** Finalidade (F59): decide o portão de consentimento aqui e no worker. */
  readonly purpose: MessagePurpose;
  /** Ver o cabeçalho: no futuro → `scheduling_unavailable`. */
  readonly scheduledFor?: Date;
  /** Chave de idempotência do envio (`messages.outbound_idempotency_key`). */
  readonly idempotencyKey?: string;
  /** Vai para `messages.metadata` (ex.: `{ via: 'copilot', proposal_id }`). */
  readonly metadata?: Record<string, unknown>;
  readonly now?: Date;
}

/** Motivo de recusa do envio, estável (vira `error_code` do item; sem PII). */
export type MemberSendRefusal =
  | 'not_found'
  | 'no_conversation'
  | 'unsupported_channel'
  | 'window_closed'
  | 'template_unsupported'
  | 'scheduling_unavailable'
  | OutboundDenyReason;

export type EnqueueMemberMessageResult =
  | {
      readonly kind: 'queued';
      readonly messageId: string;
      readonly conversationId: string;
      readonly aiPausedByHandoff: boolean;
    }
  | { readonly kind: 'replay'; readonly messageId: string; readonly conversationId: string }
  | { readonly kind: 'refused'; readonly reason: MemberSendRefusal };

/** Conversa de envio com o que a política precisa (provider, contato, última entrada). */
export interface SendableConversation extends ResolvedConversation {
  readonly id: string;
  readonly contactId: string | null;
  readonly provider: string;
}

const CHANNEL_KIND_SET: ReadonlySet<string> = new Set(CHANNEL_KINDS);

export function isChannelKind(value: string): value is ChannelKind {
  return CHANNEL_KIND_SET.has(value);
}

/** Providers com janela de 24 h conhecida (`routes/conversations/window.ts`). */
type WindowProvider = Parameters<typeof computeWindow>[0];
const WINDOW_PROVIDERS: ReadonlySet<string> = new Set([
  'meta_whatsapp',
  'meta_instagram',
  'waha',
  'email',
]);

export function isWindowProvider(value: string): value is WindowProvider {
  return WINDOW_PROVIDERS.has(value);
}

/** Estado da janela de envio do provider para a conversa (`computeWindow`, por import). */
export function windowFor(
  provider: string,
  lastInboundAt: Date | null,
  now: Date,
): WindowState | null {
  return isWindowProvider(provider) ? computeWindow(provider, lastInboundAt, now) : null;
}

/** Última mensagem INBOUND da conversa (abre a janela de 24 h). */
export async function lastInboundAt(tx: DbTx, conversationId: string): Promise<Date | null> {
  const [row] = await tx
    .select({ createdAt: schema.messages.createdAt })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.direction, 'inbound'),
      ),
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

/** Conversa (já conferida como visível) com canal e contato. */
async function loadConversation(
  tx: DbTx,
  conversationId: string,
): Promise<SendableConversation | null> {
  const [row] = await tx
    .select({
      id: schema.conversations.id,
      channelId: schema.conversations.channelId,
      remoteId: schema.conversations.remoteId,
      aiMode: schema.conversations.aiMode,
      contactId: schema.conversations.contactId,
      provider: schema.channels.provider,
    })
    .from(schema.conversations)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.conversations.channelId))
    .where(eq(schema.conversations.id, conversationId))
    .limit(1);
  return row ?? null;
}

/**
 * Conversa mais recente do contato que o membro VÊ (mesma régua da inbox), opcionalmente num
 * canal. `null` = o contato não tem conversa visível (não criamos conversa por aqui).
 */
export async function resolveContactConversation(
  tx: DbTx,
  actor: MemberActor,
  contactId: string,
  channelId?: string,
): Promise<SendableConversation | null> {
  const candidates = await tx
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.workspaceId, actor.workspaceId),
        eq(schema.conversations.contactId, contactId),
        ...(channelId ? [eq(schema.conversations.channelId, channelId)] : []),
      ),
    )
    .orderBy(
      sql`${schema.conversations.lastMessageAt} desc nulls last`,
      desc(schema.conversations.id),
    )
    .limit(20);
  for (const c of candidates) {
    if (await assertConversationVisible(tx, actor, c.id)) return loadConversation(tx, c.id);
  }
  return null;
}

/**
 * Envia (enfileira) uma mensagem em nome do membro, pelo MESMO núcleo do composer do LiveChat.
 * Recusa (sem efeito) quando: conversa invisível/inexistente, canal fora da régua, portão de
 * consentimento negou, texto livre com a janela de 24 h fechada, modelo fora do WhatsApp
 * oficial, ou agendamento pedido.
 */
export async function enqueueMemberMessage(
  tx: DbTx,
  input: EnqueueMemberMessageInput,
): Promise<EnqueueMemberMessageResult> {
  const { actor } = input;
  const now = input.now ?? new Date();
  if (input.scheduledFor && input.scheduledFor.getTime() > now.getTime()) {
    return { kind: 'refused', reason: 'scheduling_unavailable' };
  }

  let conversation: SendableConversation | null;
  if ('conversationId' in input.target) {
    const visible = await assertConversationVisible(tx, actor, input.target.conversationId);
    conversation = visible ? await loadConversation(tx, input.target.conversationId) : null;
    if (!conversation) return { kind: 'refused', reason: 'not_found' };
  } else {
    conversation = await resolveContactConversation(
      tx,
      actor,
      input.target.contactId,
      input.target.channelId,
    );
    if (!conversation) return { kind: 'refused', reason: 'no_conversation' };
  }
  const conversationId = conversation.id;

  // Idempotência: a mesma chave devolve a mensagem já criada, sem job novo.
  if (input.idempotencyKey !== undefined) {
    const [existing] = await tx
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.workspaceId, actor.workspaceId),
          eq(schema.messages.outboundIdempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) return { kind: 'replay', messageId: existing.id, conversationId };
  }

  if (!isChannelKind(conversation.provider) || !isWindowProvider(conversation.provider)) {
    return { kind: 'refused', reason: 'unsupported_channel' };
  }
  if (input.content.kind === 'template' && conversation.provider !== 'meta_whatsapp') {
    return { kind: 'refused', reason: 'template_unsupported' };
  }

  // Portão de consentimento (F59): conversa sem contato (grupo) não tem a quem perguntar e
  // não recebe envio em nome do membro por aqui.
  if (conversation.contactId === null) return { kind: 'refused', reason: 'no_conversation' };
  const decision = await checkOutboundInTx(tx, {
    workspaceId: actor.workspaceId,
    contactId: conversation.contactId,
    channel: conversation.provider,
    purpose: input.purpose,
    now,
  });
  if (!decision.allowed) return { kind: 'refused', reason: decision.reason };

  // Janela de 24 h: texto livre só com a janela aberta. Fora dela, só modelo aprovado
  // (WhatsApp). Instagram fora da janela não é atendido por aqui (a tag de atendimento humano
  // é do composer, conversa a conversa).
  if (input.content.kind === 'text') {
    const window = computeWindow(
      conversation.provider,
      await lastInboundAt(tx, conversationId),
      now,
    );
    if (!window.isOpen) return { kind: 'refused', reason: 'window_closed' };
  }

  const content = input.content;
  const persisted = await persistMemberOutbound(tx, {
    workspaceId: actor.workspaceId,
    conversationId,
    conversation,
    senderMemberId: actor.memberId,
    values: {
      type: content.kind === 'template' ? 'template' : 'text',
      content: content.kind === 'template' ? content.renderedText : content.text,
      outboundIdempotencyKey: input.idempotencyKey ?? null,
      metadata: {
        ...(input.metadata ?? {}),
        ...(content.kind === 'template' ? { templateName: content.template.templateName } : {}),
      },
    },
    job: (messageId) =>
      buildOutboundJob({
        conv: conversation,
        conversationId,
        messageId,
        body: { content: content.kind === 'text' ? content.text : null },
        mediaKind: null,
        rich: null,
        template: content.kind === 'template' ? content.template : null,
        purpose: input.purpose,
      }),
  });
  if (!persisted) return { kind: 'refused', reason: 'not_found' };
  return {
    kind: 'queued',
    messageId: persisted.message.id,
    conversationId,
    aiPausedByHandoff: persisted.aiPausedByHandoff,
  };
}
