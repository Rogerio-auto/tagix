/**
 * Normalizacao dos eventos inbound do Instagram (F15-S03, INSTAGRAM.md 3/7/8).
 *
 * O parser de @hm/channels devolve um InboundEvent discriminado com variantes
 * proprias de IG (story_mention/story_reply/share/postback/referral/comment/
 * reaction). A persistencia inbound (db-ports) reusa o caminho de mensagens do
 * WhatsApp para tudo que vira linha em `messages`. Este modulo converte as
 * variantes IG "message-like" em InboundMessageEvent (type correto + metadata +
 * mediaRef p/ download de story) e separa os comments (que tambem geram linha em
 * `ig_comments` e conversa kind='comment_thread').
 *
 * Puro e sem any — testavel sem DB.
 */
import type { InboundEvent, MediaRef, MessageType } from '@hm/channels';

/** Evento `message` canonico (o que vira linha em `messages`). */
export type NormalizedMessageEvent = Extract<InboundEvent, { type: 'message' }>;

/** Evento de comment (gera ig_comments + comment_thread). */
export type IgCommentEvent = Extract<InboundEvent, { type: 'comment' }>;

export interface NormalizedIgEvents {
  /** Eventos que viram linha em `messages` (DM + story/share/postback/referral). */
  readonly messageEvents: NormalizedMessageEvent[];
  /** Comments (persistidos em ig_comments + comment_thread). */
  readonly commentEvents: IgCommentEvent[];
}

function metaWithStory(storyId: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return { storyId, ...(extra ?? {}) };
}

/**
 * Horário do evento: usa o `rawTimestamp` real do provider quando o parser o
 * propaga (F52-S08); só cai para `new Date()` quando o payload IG genuinamente
 * não o traz. Garante ordenação fiel da timeline (e `provider_timestamp` correto)
 * mesmo em reprocessamento/entrega fora de ordem — antes era sempre `new Date()`,
 * embaralhando story/share/postback/referral.
 */
function eventTimestamp(rawTimestamp: string | undefined): string {
  return rawTimestamp ?? new Date().toISOString();
}

/**
 * Converte um InboundEvent IG em NormalizedMessageEvent quando aplicavel.
 * Retorna undefined para eventos que nao viram mensagem (reaction/status) ou
 * que sao tratados a parte (comment).
 */
function toMessageEvent(event: InboundEvent): NormalizedMessageEvent | undefined {
  switch (event.type) {
    case 'message':
      // DM ja vem normalizado pelo parser.
      return event;
    case 'story_mention': {
      const ev: NormalizedMessageEvent = {
        type: 'message',
        provider: event.provider,
        contactRemoteId: event.contactRemoteId,
        externalId: event.externalId,
        messageType: 'story_mention' as MessageType,
        mediaRef: event.mediaRef,
        rawTimestamp: eventTimestamp(event.rawTimestamp),
        metadata: metaWithStory(event.storyId, { storyUrl: event.mediaRef.refOrUrl }),
      };
      return ev;
    }
    case 'story_reply':
      return {
        type: 'message',
        provider: event.provider,
        contactRemoteId: event.contactRemoteId,
        externalId: event.externalId,
        messageType: 'story_reply' as MessageType,
        content: event.content,
        rawTimestamp: eventTimestamp(event.rawTimestamp),
        metadata: metaWithStory(event.storyId),
      };
    case 'share': {
      const mediaRef: MediaRef | undefined =
        event.mediaRef.refOrUrl.length > 0 ? event.mediaRef : undefined;
      return {
        type: 'message',
        provider: event.provider,
        contactRemoteId: event.contactRemoteId,
        externalId: event.externalId,
        messageType: 'share' as MessageType,
        ...(mediaRef ? { mediaRef } : {}),
        rawTimestamp: eventTimestamp(event.rawTimestamp),
      };
    }
    case 'postback':
      return {
        type: 'message',
        provider: event.provider,
        contactRemoteId: event.contactRemoteId,
        externalId: event.externalId,
        messageType: 'ig_postback' as MessageType,
        content: event.payload,
        rawTimestamp: eventTimestamp(event.rawTimestamp),
        metadata: { payload: event.payload, ...(event.title !== undefined ? { title: event.title } : {}) },
      };
    case 'referral':
      return {
        type: 'message',
        provider: event.provider,
        contactRemoteId: event.contactRemoteId,
        externalId: 'ref_' + event.contactRemoteId + '_' + event.source,
        messageType: 'referral' as MessageType,
        rawTimestamp: eventTimestamp(event.rawTimestamp),
        metadata: { source: event.source, referral: event.referralData },
      };
    default:
      // status, reaction, comment, story_mention já tratados acima ou a parte.
      return undefined;
  }
}

/**
 * Normaliza uma lista de InboundEvent IG, separando o que vira mensagem do que
 * vira comment. Eventos nao-IG passam intactos (so `message` vira message).
 */
export function normalizeIgEvents(events: readonly InboundEvent[]): NormalizedIgEvents {
  const messageEvents: NormalizedMessageEvent[] = [];
  const commentEvents: IgCommentEvent[] = [];

  for (const event of events) {
    if (event.type === 'comment') {
      commentEvents.push(event);
      continue;
    }
    const msg = toMessageEvent(event);
    if (msg) messageEvents.push(msg);
  }

  return { messageEvents, commentEvents };
}
