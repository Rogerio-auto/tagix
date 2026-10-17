/**
 * `OutboundJob` da API (F1-S24 / LIVECHAT.md §3; extraído de `routes/conversations/messages.ts`
 * no F73-S09, sem mudar o shape).
 *
 * O shape publicado é o contrato EXATO de `parseOutboundJob` (`apps/workers/src/outbound/job.ts`):
 * `kind` discrimina text/media/rich/template, com `channelId`/`conversationId`/`messageId`/
 * `chatId` da conversa resolvida. O módulo do job vive em `apps/workers` (fora do grafo de
 * imports da API), então este builder é a fonte do shape na borda: a rota do LiveChat e o envio
 * em nome do membro (`send-on-behalf.ts`, Copiloto) passam por aqui.
 *
 * `purpose` (F59-S05) só entra no job quando o chamador o informa: o composer do LiveChat não
 * informa (o worker assume `transactional`, comportamento de sempre); o envio em nome do membro
 * informa sempre, para o portão de consentimento do worker decidir com a MESMA finalidade que a
 * checagem de política usou (o worker é a última barreira).
 */
import type { ContactsPayload, LocationPayload, MessagePurpose, ReactionPayload } from '@hm/shared';

/**
 * Tags IG fora da janela 24h — espelham `igMessageTagSchema` do worker. Mantidas
 * locais para não importar do grafo de `apps/workers` (fora do build da API).
 */
export const IG_MESSAGE_TAGS = [
  'HUMAN_AGENT',
  'CONFIRMED_EVENT_UPDATE',
  'POST_PURCHASE_UPDATE',
  'ACCOUNT_UPDATE',
] as const;
export type IgMessageTagValue = (typeof IG_MESSAGE_TAGS)[number];

/** Kinds de mídia enviáveis — espelham `outboundMediaKindSchema` do worker. */
export type MediaKind = 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker';

/**
 * Payload rico já validado, pronto para persistir + montar o job. `reaction`
 * carrega o `targetExternalId` resolvido sob RLS (não o `targetMessageId` cru).
 */
export type RichPayload =
  | { readonly kind: 'location'; readonly location: LocationPayload }
  | { readonly kind: 'contacts'; readonly contacts: ContactsPayload }
  | {
      readonly kind: 'reaction';
      readonly reaction: ReactionPayload;
      readonly targetExternalId: string;
    };

/** Conversa resolvida sob RLS: canal (credencial), id no provider e modo de IA. */
export interface ResolvedConversation {
  readonly channelId: string;
  readonly remoteId: string;
  readonly aiMode: string;
}

/** Corpo já validado do envio (o subconjunto que o job usa). */
export interface OutboundBody {
  readonly content?: string | null;
  readonly mediaUrl?: string | null;
  readonly mediaMime?: string | null;
  readonly messageTag?: IgMessageTagValue | undefined;
}

/** Componente de modelo HSM no shape do serializer WA (F58-S12: `sub_type` + `index`). */
export interface OutboundTemplateComponentInput {
  readonly type: 'header' | 'body' | 'button';
  readonly sub_type?: string;
  readonly index?: string;
  readonly parameters: readonly { readonly type: 'text'; readonly text: string }[];
}

/** Modelo aprovado (WhatsApp oficial): reabre conversa fechada há mais de 24 h. */
export interface OutboundTemplate {
  readonly templateName: string;
  readonly languageCode: string;
  readonly components: readonly OutboundTemplateComponentInput[];
}

/**
 * Monta o `OutboundJob` no shape EXATO de `parseOutboundJob`. `chatId` é o id do
 * contato no provider (`conversations.remote_id`); `channelId` resolve a
 * credencial; `messageId` correlaciona o status final.
 */
export function buildOutboundJob(args: {
  readonly conv: ResolvedConversation;
  readonly conversationId: string;
  readonly messageId: string;
  readonly body: OutboundBody;
  readonly mediaKind: MediaKind | null;
  readonly rich: RichPayload | null;
  /** Modelo aprovado: tem precedência sobre texto/mídia. */
  readonly template?: OutboundTemplate | null;
  /** Ausente = o worker assume `transactional` (o composer do LiveChat). */
  readonly purpose?: MessagePurpose;
}): Record<string, unknown> {
  const { conv, conversationId, messageId, body, mediaKind, rich, template, purpose } = args;
  const base = {
    channelId: conv.channelId,
    conversationId,
    messageId,
    chatId: conv.remoteId,
    ...(purpose !== undefined ? { purpose } : {}),
  };

  if (template) {
    return {
      kind: 'template',
      ...base,
      templateName: template.templateName,
      languageCode: template.languageCode,
      components: template.components.map((c) => ({
        type: c.type,
        ...(c.sub_type !== undefined ? { sub_type: c.sub_type } : {}),
        ...(c.index !== undefined ? { index: c.index } : {}),
        parameters: c.parameters.map((p) => ({ type: p.type, text: p.text })),
      })),
    };
  }

  if (rich) {
    switch (rich.kind) {
      case 'location':
        return {
          kind: 'location',
          ...base,
          latitude: rich.location.latitude,
          longitude: rich.location.longitude,
          ...(rich.location.name !== undefined ? { name: rich.location.name } : {}),
          ...(rich.location.address !== undefined ? { address: rich.location.address } : {}),
          ...(body.messageTag ? { messageTag: body.messageTag } : {}),
        };
      case 'contacts':
        return {
          kind: 'contacts',
          ...base,
          contacts: rich.contacts.contacts,
          ...(body.messageTag ? { messageTag: body.messageTag } : {}),
        };
      case 'reaction':
        return {
          kind: 'reaction',
          ...base,
          targetExternalId: rich.targetExternalId,
          emoji: rich.reaction.emoji,
        };
    }
  }

  if (mediaKind) {
    return {
      kind: 'media',
      ...base,
      mediaKind,
      // `mediaUrl`/`mediaMime` já validados como presentes antes desta chamada.
      publicMediaUrl: body.mediaUrl,
      mime: body.mediaMime,
      ...(body.content ? { caption: body.content } : {}),
      ...(body.messageTag ? { messageTag: body.messageTag } : {}),
    };
  }

  return {
    kind: 'text',
    ...base,
    text: body.content,
    ...(body.messageTag ? { messageTag: body.messageTag } : {}),
  };
}
