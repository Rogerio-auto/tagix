/**
 * MetaWhatsAppAdapter — implementação completa do `IChannelAdapter` para o
 * provider `meta_whatsapp` (WhatsApp Cloud API, Graph v23.0).
 *
 * Responsabilidades: parse de webhook inbound, envio (text/media/template/
 * interactive), download de mídia, markAsRead e typing indicator. Usa o
 * `GraphClient` compartilhado para HTTP (retry/timeout) e os serializers /
 * parser deste diretório. Sem `any` (LIVECHAT.md §2.2, §4).
 */

import type { GraphClient } from '../../shared/graphClient';
import { MetaError } from '../../shared/errors';
import type {
  AdapterCapabilities,
  Channel,
  IChannelAdapter,
  InboundEvent,
  SendInteractiveInput,
  SendMediaInput,
  SendResult,
  SendTemplateInput,
  SendTextInput,
} from '../../types';
import { parseWhatsAppWebhook } from './webhook.parser';
import {
  InteractiveSerializeError,
  serializeInteractive,
  serializeMedia,
  serializeTemplate,
  serializeText,
} from './serializer';
import { mapWaError } from './errors';

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class MetaWhatsAppAdapter implements IChannelAdapter {
  readonly provider = 'meta_whatsapp' as const;

  /**
   * Capabilities reais do WhatsApp: HSM, PTT, sticker e location nativos;
   * nada de stories/comments/message tags (próprios do Instagram).
   */
  readonly capabilities: AdapterCapabilities = {
    templatesHSM: true,
    storyMentions: false,
    storyReplies: false,
    publicComments: false,
    messageTags: false,
    voicePtt: true,
    sticker: true,
    location: true,
  };

  constructor(private readonly graph: GraphClient) {}

  // --- Inbound ---

  async parseInbound(payload: unknown, _channel: Channel): Promise<InboundEvent[]> {
    return parseWhatsAppWebhook(payload);
  }

  // --- Outbound ---

  async sendText(input: SendTextInput, channel: Channel): Promise<SendResult> {
    return this.send(serializeText(input), channel);
  }

  async sendMedia(input: SendMediaInput, channel: Channel): Promise<SendResult> {
    return this.send(serializeMedia(input), channel);
  }

  async sendTemplate(input: SendTemplateInput, channel: Channel): Promise<SendResult> {
    return this.send(serializeTemplate(input), channel);
  }

  async sendInteractive(input: SendInteractiveInput, channel: Channel): Promise<SendResult> {
    try {
      const body = serializeInteractive(input.payload, input.contactRemoteId);
      return await this.send(body, channel);
    } catch (err: unknown) {
      if (err instanceof InteractiveSerializeError) {
        return { ok: false, errorCode: 'WA_INTERACTIVE_INVALID', errorMessage: err.message };
      }
      throw err;
    }
  }

  // --- Mídia / presença ---

  /**
   * Baixa uma mídia recebida. `refOrUrl` pode ser um `media_id` WA (resolve a
   * URL temporária via Graph) ou já uma URL absoluta.
   */
  async downloadMedia(refOrUrl: string, channel: Channel): Promise<Buffer> {
    let url = refOrUrl;
    if (!/^https?:\/\//.test(refOrUrl)) {
      // media_id → GET /{media_id} retorna { url, mime_type, ... }.
      const meta = await this.graph.get(refOrUrl, channel.accessToken);
      const resolved = isRecord(meta) && typeof meta['url'] === 'string' ? meta['url'] : undefined;
      if (resolved === undefined) {
        throw new MetaError(`Falha ao resolver URL da mídia '${refOrUrl}'.`, {
          httpStatus: 0,
          retryable: false,
          raw: meta,
        });
      }
      url = resolved;
    }
    // A URL de mídia da Graph exige o Bearer token.
    return this.graph.downloadBinary(url, channel.accessToken);
  }

  /** Marca a mensagem como lida (status=read) na conversa. */
  async markAsRead(externalId: string, channel: Channel): Promise<void> {
    if (channel.phoneNumberId === undefined) return;
    await this.graph.post(
      `${channel.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', status: 'read', message_id: externalId },
      channel.accessToken,
    );
  }

  /**
   * Indicador de digitação. A Cloud API só expõe "typing" atrelado a uma
   * `markAsRead` (typing_indicator). `recording` não é suportado → tratado
   * como typing.
   */
  async sendTypingIndicator(
    externalId: string,
    _kind: 'typing' | 'recording',
    channel: Channel,
  ): Promise<void> {
    if (channel.phoneNumberId === undefined) return;
    await this.graph.post(
      `${channel.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: externalId,
        typing_indicator: { type: 'text' },
      },
      channel.accessToken,
    );
  }

  // --- Internos ---

  /** Executa o POST /messages e normaliza a resposta em `SendResult`. */
  private async send(body: JsonRecord, channel: Channel): Promise<SendResult> {
    if (channel.phoneNumberId === undefined) {
      return {
        ok: false,
        errorCode: 'WA_NO_PHONE_NUMBER_ID',
        errorMessage: 'Canal WhatsApp sem phoneNumberId configurado.',
      };
    }
    try {
      const res = await this.graph.post(
        `${channel.phoneNumberId}/messages`,
        body,
        channel.accessToken,
      );
      const externalId = extractMessageId(res);
      if (externalId === undefined) {
        return {
          ok: false,
          errorCode: 'WA_NO_MESSAGE_ID',
          errorMessage: 'Resposta da Graph sem messages[].id.',
          raw: res,
        };
      }
      return { ok: true, externalId, raw: res };
    } catch (err: unknown) {
      return toSendResult(err);
    }
  }
}

/** Extrai `messages[0].id` da resposta da Cloud API. */
function extractMessageId(res: unknown): string | undefined {
  if (!isRecord(res)) return undefined;
  const messages = res['messages'];
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  const first = messages[0];
  if (!isRecord(first)) return undefined;
  return typeof first['id'] === 'string' ? first['id'] : undefined;
}

/** Converte um erro (MetaError ou genérico) num `SendResult` falho tipado. */
function toSendResult(err: unknown): SendResult {
  if (err instanceof MetaError) {
    const info = mapWaError(err.code);
    return {
      ok: false,
      errorCode: err.code !== undefined ? `WA_${err.code}` : 'WA_ERROR',
      errorMessage: info.message !== undefined ? info.message : err.message,
      raw: err.raw,
    };
  }
  const message = err instanceof Error ? err.message : 'Erro desconhecido no envio.';
  return { ok: false, errorCode: 'WA_UNKNOWN', errorMessage: message };
}
