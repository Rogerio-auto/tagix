/**
 * WAHAAdapter — implementação completa do `IChannelAdapter` para o provider
 * `waha` (WhatsApp HTTP API não-oficial).
 *
 * Responsabilidades: parse de webhook inbound, envio (text/media/voice/sticker/
 * location), download de mídia, markAsRead (sendSeen) e typing/recording. Usa o
 * `WahaClient` para HTTP (retry/timeout) e `ensureSession` para garantir a
 * sessão ativa antes de cada operação de saída. Sem `any` (LIVECHAT.md §2.3).
 *
 * `templatesHSM`/`sendInteractive` não existem na WAHA → retornam erro tipado.
 * WAHA não tem janela 24h (composer sempre livre).
 */

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
} from '../types';
import { WahaError, type WahaClient, type WahaJsonBody } from './client';
import { ensureSession } from './session';
import { parseWahaWebhook } from './webhook.parser';

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Mapeia o `mediaKind` canônico para o endpoint de envio da WAHA. */
const MEDIA_ENDPOINT: Record<SendMediaInput['mediaKind'], string> = {
  image: '/api/sendImage',
  video: '/api/sendVideo',
  audio: '/api/sendFile',
  voice: '/api/sendVoice',
  document: '/api/sendFile',
  sticker: '/api/sendImage',
};

export class WAHAAdapter implements IChannelAdapter {
  readonly provider = 'waha' as const;

  /**
   * Capabilities da WAHA: voz (PTT), sticker e localização nativos; sem HSM,
   * sem recursos Instagram (stories/comments/message tags).
   */
  readonly capabilities: AdapterCapabilities = {
    templatesHSM: false,
    storyMentions: false,
    storyReplies: false,
    publicComments: false,
    messageTags: false,
    voicePtt: true,
    sticker: true,
    location: true,
  };

  /**
   * @param client  Cliente HTTP WAHA (carrega baseUrl + apiKey da instância).
   * @param session Nome da sessão WAHA (uma conta WhatsApp). Default: 'default'.
   */
  constructor(
    private readonly client: WahaClient,
    private readonly session: string = 'default',
  ) {}

  // --- Inbound ---

  async parseInbound(payload: unknown, _channel: Channel): Promise<InboundEvent[]> {
    return parseWahaWebhook(payload);
  }

  // --- Outbound ---

  async sendText(input: SendTextInput, _channel: Channel): Promise<SendResult> {
    return this.send('/api/sendText', {
      ...this.base(input.contactRemoteId),
      text: input.text,
      ...this.reply(input.replyToExternalId),
    });
  }

  async sendMedia(input: SendMediaInput, _channel: Channel): Promise<SendResult> {
    const endpoint = MEDIA_ENDPOINT[input.mediaKind];
    const supportsCaption =
      input.mediaKind === 'image' ||
      input.mediaKind === 'video' ||
      input.mediaKind === 'document';

    const file: WahaJsonBody = { mimetype: input.mime, url: input.publicMediaUrl };

    const body: WahaJsonBody = {
      ...this.base(input.contactRemoteId),
      file,
      ...(supportsCaption && input.caption !== undefined ? { caption: input.caption } : {}),
      ...this.reply(input.replyToExternalId),
    };
    return this.send(endpoint, body);
  }

  /** WAHA não tem templates HSM (recurso da Cloud API oficial). */
  async sendTemplate(_input: SendTemplateInput, _channel: Channel): Promise<SendResult> {
    return {
      ok: false,
      errorCode: 'WAHA_NO_HSM',
      errorMessage: 'WAHA não suporta templates HSM (recurso da WhatsApp Cloud API oficial).',
    };
  }

  /** WAHA não suporta mensagens interativas nativas (buttons/list). */
  async sendInteractive(_input: SendInteractiveInput, _channel: Channel): Promise<SendResult> {
    return {
      ok: false,
      errorCode: 'WAHA_NO_INTERACTIVE',
      errorMessage: 'WAHA não suporta mensagens interativas (buttons/list).',
    };
  }

  // --- Mídia / presença ---

  /**
   * Baixa uma mídia recebida. Na WAHA, `refOrUrl` já é a URL servida pela
   * instância (campo `media.url` do webhook).
   */
  async downloadMedia(refOrUrl: string, _channel: Channel): Promise<Buffer> {
    return this.client.downloadBinary(refOrUrl);
  }

  /** Marca a mensagem como lida (`POST /api/sendSeen`). */
  async markAsRead(externalId: string, _channel: Channel): Promise<void> {
    await this.ensure();
    await this.client.post('/api/sendSeen', {
      session: this.session,
      messageId: externalId,
    });
  }

  /**
   * Indicador de presença. WAHA distingue digitação de gravação de áudio:
   * `recording` → `/api/startTyping` com presença de áudio não é exposto, então
   * mapeamos `typing`→startTyping e `recording`→startTyping também (WAHA só
   * expõe typing). Mantém a assinatura do contrato.
   */
  async sendTypingIndicator(
    externalId: string,
    _kind: 'typing' | 'recording',
    _channel: Channel,
  ): Promise<void> {
    await this.ensure();
    await this.client.post('/api/startTyping', {
      session: this.session,
      chatId: externalId,
    });
  }

  // --- Internos ---

  /** Envelope-base de toda chamada de envio (`session` + `chatId`). */
  private base(contactRemoteId: string): WahaJsonBody {
    return { session: this.session, chatId: contactRemoteId };
  }

  /** Anexa contexto de reply (`reply_to`) se houver. */
  private reply(replyToExternalId?: string): WahaJsonBody {
    return replyToExternalId !== undefined ? { reply_to: replyToExternalId } : {};
  }

  /** Garante sessão WORKING antes de uma operação de saída. */
  private async ensure(): Promise<void> {
    await ensureSession(this.client, this.session);
  }

  /** Executa um POST de envio e normaliza a resposta em `SendResult`. */
  private async send(endpoint: string, body: WahaJsonBody): Promise<SendResult> {
    try {
      await this.ensure();
      const res = await this.client.post(endpoint, body);
      const externalId = extractMessageId(res);
      if (externalId === undefined) {
        return {
          ok: false,
          errorCode: 'WAHA_NO_MESSAGE_ID',
          errorMessage: 'Resposta da WAHA sem id da mensagem.',
          raw: res,
        };
      }
      return { ok: true, externalId, raw: res };
    } catch (err: unknown) {
      return toSendResult(err);
    }
  }
}

/**
 * Extrai o id da mensagem enviada da resposta WAHA. WAHA retorna `{ id: {...} }`
 * (objeto `_serialized`) ou `{ id: '...' }` ou `{ key: { id } }`.
 */
function extractMessageId(res: unknown): string | undefined {
  if (!isRecord(res)) return undefined;

  const id = res['id'];
  if (typeof id === 'string') return id;
  if (isRecord(id)) {
    const serialized = asString(id['_serialized']);
    if (serialized !== undefined) return serialized;
  }

  const key = res['key'];
  if (isRecord(key)) {
    const keyId = asString(key['id']);
    if (keyId !== undefined) return keyId;
  }
  return undefined;
}

/** Converte um erro (WahaError ou genérico) num `SendResult` falho tipado. */
function toSendResult(err: unknown): SendResult {
  if (err instanceof WahaError) {
    return {
      ok: false,
      errorCode: `WAHA_${err.httpStatus}`,
      errorMessage: err.message,
      raw: err.raw,
    };
  }
  const message = err instanceof Error ? err.message : 'Erro desconhecido no envio WAHA.';
  return { ok: false, errorCode: 'WAHA_UNKNOWN', errorMessage: message };
}
