/**
 * MetaWhatsAppAdapter — implementação completa do `IChannelAdapter` para o
 * provider `meta_whatsapp` (WhatsApp Cloud API, Graph v23.0).
 *
 * Responsabilidades: parse de webhook inbound, envio (text/media/template/
 * interactive), download de mídia, markAsRead e typing indicator. Usa o
 * `GraphClient` compartilhado para HTTP (retry/timeout) e os serializers /
 * parser deste diretório. Sem `any` (LIVECHAT.md §2.2, §4).
 *
 * ## Contrato de falha de envio (F56-S14 / INF-02)
 *
 * Os `send*` distinguem DOIS tipos de falha — a distinção é o que impede uma
 * mensagem de cliente de ser queimada por um soluço da Meta:
 *
 * - **Permanente** (conteúdo/config: número sem WhatsApp, template inválido,
 *   token revogado, fora da janela 24h…): resolve `SendResult { ok: false }`.
 *   Reprocessar não muda o desfecho → o worker persiste `failed` (visível ao
 *   usuário) e ack'a o job.
 * - **Transitória** (429/rate-limit, 5xx, timeout/rede): **lança** `MetaError`
 *   com `retryable: true`. Não é um resultado de envio — é um "ainda não". O
 *   worker outbound propaga a exceção e a ladder durável de `@hm/shared/mq`
 *   (5s → 30s → 2m → 10m → 30m) reprocessa o job, sobrevivendo a restart do
 *   worker. Antes desta mudança o `retryable` era descartado aqui e TODA falha
 *   virava `failed` imediato — cliente nunca recebia a mensagem.
 *
 * Idempotência do reenvio é garantida no worker (guard `findSentExternalId`):
 * se o POST chegou a criar um `wamid`, o job reentregue não reenvia.
 */

import type { GraphClient } from '../../shared/graphClient';
import { MetaError, isRetryableStatus } from '../../shared/errors';
import type {
  AdapterCapabilities,
  Channel,
  IChannelAdapter,
  InboundEvent,
  SendContactsInput,
  SendInteractiveInput,
  SendLocationInput,
  SendMediaInput,
  SendReactionInput,
  SendResult,
  SendTemplateInput,
  SendTextInput,
} from '../../types';
import { parseWhatsAppWebhook } from './webhook.parser';
import {
  InteractiveSerializeError,
  serializeContacts,
  serializeInteractive,
  serializeLocation,
  serializeMedia,
  serializeReaction,
  serializeTemplate,
  serializeText,
} from './serializer';
import { mapWaError, WA_ERROR_CODES } from './errors';

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

  // --- Modalidades ricas (F45) ---

  async sendLocation(input: SendLocationInput, channel: Channel): Promise<SendResult> {
    return this.send(serializeLocation(input), channel);
  }

  async sendContacts(input: SendContactsInput, channel: Channel): Promise<SendResult> {
    return this.send(serializeContacts(input), channel);
  }

  async sendReaction(input: SendReactionInput, channel: Channel): Promise<SendResult> {
    return this.send(serializeReaction(input), channel);
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
      // Transitório → exceção (ladder durável). Permanente → SendResult falho.
      throwIfTransient(err);
      return toSendResult(err);
    }
  }
}

/**
 * Falha transitória do provider? `MetaError.retryable` já cobre 429/5xx/rede
 * (httpStatus 0) e os códigos Graph genéricos de rate limit; o mapa WA
 * (`WA_ERROR_CODES`) acrescenta os códigos específicos do WhatsApp que a Meta
 * devolve com HTTP 200/400 mas são temporários (130429 rate limit da WABA,
 * 131000 erro genérico, 131016 serviço indisponível, 368 bloqueio temporário).
 */
export function isTransientWaError(err: MetaError): boolean {
  return err.retryable || isRetryableStatus(err.httpStatus) || mapWaError(err.code).retryable;
}

/**
 * Relança falha transitória como `MetaError { retryable: true }` — normalizando
 * o flag (o mapa WA sabe de códigos que o `MetaError` cru não classifica) e
 * preservando `httpStatus`/`code`/`raw` para o worker montar o `errorCode`
 * (`WA_<code>`) quando a ladder esgotar. No-op para erro permanente.
 */
function throwIfTransient(err: unknown): void {
  if (!(err instanceof MetaError) || !isTransientWaError(err)) return;

  const known = err.code !== undefined && err.code in WA_ERROR_CODES;
  const message = known ? mapWaError(err.code).message : err.message;

  throw new MetaError(message, {
    httpStatus: err.httpStatus,
    ...(err.code !== undefined ? { code: err.code } : {}),
    ...(err.subcode !== undefined ? { subcode: err.subcode } : {}),
    retryable: true,
    raw: err.raw,
  });
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
