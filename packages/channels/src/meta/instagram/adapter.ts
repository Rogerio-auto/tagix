/**
 * MetaInstagramAdapter — implementacao real do `IInstagramAdapter` para o
 * provider `meta_instagram` (Instagram Messaging, Graph v23.0).
 *
 * Responsabilidades: parse de webhook IG (delega ao webhook.parser), envio
 * (text/media/interactive + message_tag), acoes de comment (reply pub/priv,
 * hide, delete), download de midia de story, markAsRead e typing. Templates
 * HSM nao existem em IG -> erro tipado IG_NO_HSM. Sem any (INSTAGRAM.md 5).
 */

import type { GraphClient } from '../../shared/graphClient';
import { MetaError } from '../../shared/errors';
import type {
  AdapterCapabilities,
  Channel,
  IInstagramAdapter,
  IgCommentReplyInput,
  InboundEvent,
  SendInteractiveInput,
  SendMediaInput,
  SendResult,
  SendTemplateInput,
  SendTextInput,
} from '../../types';
import { parseInstagramWebhook } from './webhook.parser';
import { serializeText, serializeMedia, serializeInteractive } from './serializer';
import { replyPublic, replyPrivate, hideComment, deleteComment } from './comments';
import { downloadStoryMedia } from './stories';
import { IG_ERROR_CODES, IG_ERROR_MESSAGES, IgInteractiveSerializeError } from './errors';

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class MetaInstagramAdapter implements IInstagramAdapter {
  readonly provider = 'meta_instagram' as const;

  readonly capabilities: AdapterCapabilities = {
    templatesHSM: false,
    storyMentions: true,
    storyReplies: true,
    publicComments: true,
    messageTags: true,
    voicePtt: false,
    sticker: false,
    location: false,
  };

  constructor(private readonly graph: GraphClient) {}

  // --- Inbound ---

  async parseInbound(payload: unknown, _channel: Channel): Promise<InboundEvent[]> {
    return parseInstagramWebhook(payload);
  }

  // --- Outbound ---

  async sendText(input: SendTextInput, channel: Channel): Promise<SendResult> {
    return this.send(serializeText(input), channel);
  }

  async sendMedia(input: SendMediaInput, channel: Channel): Promise<SendResult> {
    return this.send(serializeMedia(input), channel);
  }

  /** Instagram NAO tem templates HSM -> erro tipado dedicado (5.2). */
  async sendTemplate(_input: SendTemplateInput, _channel: Channel): Promise<SendResult> {
    return {
      ok: false,
      errorCode: IG_ERROR_CODES.NO_HSM,
      errorMessage: IG_ERROR_MESSAGES[IG_ERROR_CODES.NO_HSM],
    };
  }

  async sendInteractive(input: SendInteractiveInput, channel: Channel): Promise<SendResult> {
    try {
      const body = serializeInteractive(input.payload, input.contactRemoteId, input.messageTag);
      return await this.send(body, channel);
    } catch (err: unknown) {
      if (err instanceof IgInteractiveSerializeError) {
        return {
          ok: false,
          errorCode: IG_ERROR_CODES.INTERACTIVE_INVALID,
          errorMessage: err.message,
        };
      }
      throw err;
    }
  }

  // --- Comment actions (IG-only) ---

  async sendPrivateReplyToComment(
    input: IgCommentReplyInput,
    channel: Channel,
  ): Promise<SendResult> {
    const igUserId = this.requireIgUserId(channel);
    if (igUserId === undefined) return this.noIgUserId();
    try {
      const res = await replyPrivate(this.graph, igUserId, input.commentId, input.text, channel.accessToken);
      return res.id !== undefined
        ? { ok: true, externalId: res.id, raw: res.raw }
        : { ok: true, externalId: input.commentId, raw: res.raw };
    } catch (err: unknown) {
      return toSendResult(err);
    }
  }

  async replyPublicToComment(input: IgCommentReplyInput, channel: Channel): Promise<SendResult> {
    try {
      const res = await replyPublic(this.graph, input.commentId, input.text, channel.accessToken);
      return res.id !== undefined
        ? { ok: true, externalId: res.id, raw: res.raw }
        : { ok: true, externalId: input.commentId, raw: res.raw };
    } catch (err: unknown) {
      return toSendResult(err);
    }
  }

  async hideComment(commentId: string, channel: Channel, hide = true): Promise<void> {
    await hideComment(this.graph, commentId, hide, channel.accessToken);
  }

  async deleteComment(commentId: string, channel: Channel): Promise<void> {
    await deleteComment(this.graph, commentId, channel.accessToken);
  }

  // --- Midia / presenca ---

  async downloadMedia(refOrUrl: string, channel: Channel): Promise<Buffer> {
    // IG attachments vem como URL temporaria (~5min) que serve o binario direto.
    return downloadStoryMedia(this.graph, refOrUrl, channel.accessToken);
  }

  async markAsRead(externalId: string, channel: Channel): Promise<void> {
    const igUserId = this.requireIgUserId(channel);
    if (igUserId === undefined) return;
    await this.graph.post(
      igUserId + '/messages',
      { recipient: { id: externalId }, sender_action: 'mark_seen' },
      channel.accessToken,
    );
  }

  async sendTypingIndicator(
    externalId: string,
    _kind: 'typing' | 'recording',
    channel: Channel,
  ): Promise<void> {
    const igUserId = this.requireIgUserId(channel);
    if (igUserId === undefined) return;
    // IG so suporta typing_on/typing_off; 'recording' degrada para typing.
    await this.graph.post(
      igUserId + '/messages',
      { recipient: { id: externalId }, sender_action: 'typing_on' },
      channel.accessToken,
    );
  }

  // --- Internos ---

  private requireIgUserId(channel: Channel): string | undefined {
    return channel.igUserId;
  }

  private noIgUserId(): SendResult {
    return {
      ok: false,
      errorCode: IG_ERROR_CODES.NO_IG_USER_ID,
      errorMessage: IG_ERROR_MESSAGES[IG_ERROR_CODES.NO_IG_USER_ID],
    };
  }

  private async send(body: JsonRecord, channel: Channel): Promise<SendResult> {
    const igUserId = this.requireIgUserId(channel);
    if (igUserId === undefined) return this.noIgUserId();
    try {
      const res = await this.graph.post(igUserId + '/messages', body, channel.accessToken);
      const externalId = extractMessageId(res);
      if (externalId === undefined) {
        return {
          ok: false,
          errorCode: IG_ERROR_CODES.NO_MESSAGE_ID,
          errorMessage: IG_ERROR_MESSAGES[IG_ERROR_CODES.NO_MESSAGE_ID],
          raw: res,
        };
      }
      return { ok: true, externalId, raw: res };
    } catch (err: unknown) {
      return toSendResult(err);
    }
  }
}

/** IG retorna { message_id, recipient_id } no envio de DM. */
function extractMessageId(res: unknown): string | undefined {
  if (!isRecord(res)) return undefined;
  const mid = res['message_id'];
  if (typeof mid === 'string') return mid;
  const id = res['id'];
  return typeof id === 'string' ? id : undefined;
}

function toSendResult(err: unknown): SendResult {
  if (err instanceof MetaError) {
    return {
      ok: false,
      errorCode: err.code !== undefined ? 'IG_' + String(err.code) : IG_ERROR_CODES.GENERIC,
      errorMessage: err.message,
      raw: err.raw,
    };
  }
  const message = err instanceof Error ? err.message : IG_ERROR_MESSAGES[IG_ERROR_CODES.UNKNOWN];
  return { ok: false, errorCode: IG_ERROR_CODES.UNKNOWN, errorMessage: message };
}
