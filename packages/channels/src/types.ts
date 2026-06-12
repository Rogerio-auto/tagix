/**
 * Fronteira de canais — `IChannelAdapter` e tipos de inbound/outbound.
 *
 * Espelha `docs/features/LIVECHAT.md` §2.1. O worker outbound roteia por
 * `provider` e nunca conhece detalhes da Meta Cloud API / WAHA.
 */

import type { ChannelProvider } from '@hm/shared';

// --- Tipos de mensagem suportados (DATA_MODEL §messages.type; vide INSTAGRAM.md §3.3) ---
export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'voice'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'interactive'
  | 'template'
  | 'reaction'
  | 'system'
  // Instagram-specific
  | 'story_mention'
  | 'story_reply'
  | 'share'
  | 'comment'
  | 'comment_reply'
  | 'ig_postback'
  | 'referral';

/** Referência a uma mídia recebida (ainda não baixada para o R2). */
export interface MediaRef {
  /** Ref opaca do provider (ex.: media_id WA) OU URL temporária (ex.: story IG). */
  readonly refOrUrl: string;
  readonly mimeType?: string;
  readonly sha256?: string;
  readonly fileName?: string;
}

/**
 * Snapshot do canal entregue ao adapter em cada chamada. Subset do row
 * `channels` + secret descifrado, suficiente para falar com o provider.
 */
export interface Channel {
  readonly id: string;
  readonly workspaceId: string;
  readonly provider: ChannelProvider;
  readonly accessToken: string;
  // WhatsApp
  readonly phoneNumberId?: string;
  readonly wabaId?: string;
  // Instagram
  readonly igUserId?: string;
  readonly fbPageId?: string;
}

/** Tag de mensagem IG fora da janela 24h (vide INSTAGRAM.md §6). */
export type IgMessageTag =
  | 'HUMAN_AGENT'
  | 'CONFIRMED_EVENT_UPDATE'
  | 'POST_PURCHASE_UPDATE'
  | 'ACCOUNT_UPDATE';

// --- Inputs de envio (outbound) ---

export interface SendTextInput {
  readonly contactRemoteId: string;
  readonly text: string;
  readonly replyToExternalId?: string;
  readonly messageTag?: IgMessageTag;
}

export interface SendMediaInput {
  readonly contactRemoteId: string;
  readonly mediaKind: 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker';
  /** URL pública servível ao provider (Meta busca o binário). */
  readonly publicMediaUrl: string;
  readonly mime: string;
  readonly caption?: string;
  readonly replyToExternalId?: string;
  readonly messageTag?: IgMessageTag;
}

export interface TemplateComponent {
  readonly type: 'header' | 'body' | 'button';
  readonly parameters?: readonly unknown[];
}

export interface SendTemplateInput {
  readonly contactRemoteId: string;
  readonly templateName: string;
  readonly languageCode: string;
  readonly components: readonly TemplateComponent[];
}

export interface SendInteractiveInput {
  readonly contactRemoteId: string;
  /** Payload Highermind (discriminated union em `@hm/shared`, vide INSTAGRAM.md §9). */
  readonly payload: unknown;
  readonly messageTag?: IgMessageTag;
}

// --- Eventos inbound (LIVECHAT.md §2.1) ---

export type InboundEvent =
  | {
      type: 'message';
      provider: ChannelProvider;
      contactRemoteId: string;
      externalId: string;
      messageType: MessageType;
      content?: string;
      mediaRef?: MediaRef;
      rawTimestamp: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: 'status';
      provider: ChannelProvider;
      externalId: string;
      status: 'sent' | 'delivered' | 'read' | 'failed';
      rawTimestamp: string;
    }
  | {
      type: 'flow_submission';
      provider: 'meta_whatsapp';
      metaFlowId: string;
      response: unknown;
      externalId: string;
    }
  | {
      type: 'story_mention';
      provider: 'meta_instagram';
      contactRemoteId: string;
      externalId: string;
      mediaRef: MediaRef;
      storyId: string;
    }
  | {
      type: 'story_reply';
      provider: 'meta_instagram';
      contactRemoteId: string;
      externalId: string;
      storyId: string;
      content: string;
    }
  | {
      type: 'share';
      provider: 'meta_instagram';
      contactRemoteId: string;
      externalId: string;
      mediaRef: MediaRef;
    }
  | {
      type: 'comment';
      provider: 'meta_instagram';
      mediaId: string;
      mediaKind?: 'post' | 'reel' | 'story';
      commentId: string;
      parentCommentId?: string;
      fromIgsId: string;
      fromUsername?: string;
      text?: string;
    }
  | {
      type: 'postback';
      provider: 'meta_instagram';
      contactRemoteId: string;
      externalId: string;
      payload: string;
      title?: string;
    }
  | {
      type: 'reaction';
      provider: ChannelProvider;
      contactRemoteId: string;
      targetExternalId: string;
      emoji: string;
    }
  | {
      type: 'referral';
      provider: 'meta_instagram';
      contactRemoteId: string;
      source: string;
      referralData: Record<string, unknown>;
    };

// --- Resultado de envio (LIVECHAT.md §2.1) ---

export type SendResult =
  | { ok: true; externalId: string; raw?: unknown }
  | { ok: false; errorCode: string; errorMessage: string; raw?: unknown };

/**
 * Capabilities anunciadas pelo adapter. A UI consulta para esconder/mostrar
 * ações por canal (LIVECHAT.md §2.1).
 */
export interface AdapterCapabilities {
  readonly templatesHSM: boolean; // só meta_whatsapp
  readonly storyMentions: boolean; // só meta_instagram
  readonly storyReplies: boolean; // só meta_instagram
  readonly publicComments: boolean; // só meta_instagram
  readonly messageTags: boolean; // só meta_instagram (HUMAN_AGENT, etc.)
  readonly voicePtt: boolean; // só meta_whatsapp + waha
  readonly sticker: boolean; // meta_whatsapp + waha
  readonly location: boolean; // meta_whatsapp + waha
}

// --- Inputs/result de acoes de comment IG (INSTAGRAM.md 7.2) ---

export interface IgCommentReplyInput {
  readonly commentId: string;
  readonly text: string;
}

/**
 * Adapter Instagram: estende o contrato base com as acoes de comment/story que
 * so existem em IG. Mantido separado de `IChannelAdapter` para nao forcar
 * WhatsApp/WAHA a implementar metodos que nao possuem (aditivo).
 */
export interface IInstagramAdapter extends IChannelAdapter {
  /** Comment-to-DM (recipient.comment_id). */
  sendPrivateReplyToComment(input: IgCommentReplyInput, channel: Channel): Promise<SendResult>;
  /** Reply publica (POST /{comment-id}/replies). */
  replyPublicToComment(input: IgCommentReplyInput, channel: Channel): Promise<SendResult>;
  /** Oculta/exibe um comment. */
  hideComment(commentId: string, channel: Channel, hide?: boolean): Promise<void>;
  /** Remove um comment. */
  deleteComment(commentId: string, channel: Channel): Promise<void>;
}

/**
 * Contrato único de adapter de canal. Implementações: MetaWhatsAppAdapter
 * (F1-S08), MetaInstagramAdapter (este slot, STUB), WAHAAdapter (F1-S18).
 */
export interface IChannelAdapter {
  readonly provider: ChannelProvider;
  readonly capabilities: AdapterCapabilities;

  parseInbound(payload: unknown, channel: Channel): Promise<InboundEvent[]>;

  sendText(input: SendTextInput, channel: Channel): Promise<SendResult>;
  sendMedia(input: SendMediaInput, channel: Channel): Promise<SendResult>;
  /** WA only; IG retorna `{ ok:false, errorCode:'IG_NO_HSM' }`. */
  sendTemplate(input: SendTemplateInput, channel: Channel): Promise<SendResult>;
  sendInteractive(input: SendInteractiveInput, channel: Channel): Promise<SendResult>;

  downloadMedia(refOrUrl: string, channel: Channel): Promise<Buffer>;
  markAsRead(externalId: string, channel: Channel): Promise<void>;
  sendTypingIndicator(
    externalId: string,
    kind: 'typing' | 'recording',
    channel: Channel,
  ): Promise<void>;
}
