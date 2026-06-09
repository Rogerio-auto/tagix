/**
 * MetaInstagramAdapter — STUB.
 *
 * A implementação real (parsing de webhook IG, serializers, stories, comments)
 * fica para a fase F1.5 (vide INSTAGRAM.md §5, §16). Aqui só fixamos a fronteira:
 * a classe implementa `IChannelAdapter` com as `capabilities` corretas de IG,
 * e os métodos de envio/parse retornam erro tipado / lista vazia com `warn`.
 */

import type { GraphClient } from '../../shared/graphClient';
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

/** Código de erro padrão deste STUB (envio ainda não implementado). */
const IG_NOT_IMPLEMENTED = 'IG_NOT_IMPLEMENTED' as const;
const STUB_MESSAGE =
  'MetaInstagramAdapter é um STUB (impl. real em F1.5 — vide INSTAGRAM.md §5).';

export class MetaInstagramAdapter implements IChannelAdapter {
  readonly provider = 'meta_instagram' as const;

  /**
   * Capabilities verdadeiras de Instagram: sem HSM, mas com stories, comments
   * públicos e message tags. Sem PTT/sticker/location nativos (LIVECHAT.md §2.1,
   * INSTAGRAM.md §1).
   */
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

  // `graph` será usado pela impl. real (F1.5); mantido para fixar a assinatura.
  constructor(private readonly graph: GraphClient) {
    void this.graph;
  }

  // --- Inbound ---

  async parseInbound(_payload: unknown, _channel: Channel): Promise<InboundEvent[]> {
    console.warn(`[ig] parseInbound não implementado. ${STUB_MESSAGE}`);
    return [];
  }

  // --- Outbound (todos STUB) ---

  async sendText(_input: SendTextInput, _channel: Channel): Promise<SendResult> {
    return this.notImplemented('sendText');
  }

  async sendMedia(_input: SendMediaInput, _channel: Channel): Promise<SendResult> {
    return this.notImplemented('sendMedia');
  }

  /** Instagram NÃO tem templates HSM — erro tipado dedicado (INSTAGRAM.md §5.2). */
  async sendTemplate(_input: SendTemplateInput, _channel: Channel): Promise<SendResult> {
    return {
      ok: false,
      errorCode: 'IG_NO_HSM',
      errorMessage:
        'Instagram não suporta templates HSM. Use generic_template/quick_replies na janela 24h ou tag HUMAN_AGENT.',
    };
  }

  async sendInteractive(
    _input: SendInteractiveInput,
    _channel: Channel,
  ): Promise<SendResult> {
    return this.notImplemented('sendInteractive');
  }

  // --- Mídia / presença ---

  async downloadMedia(_refOrUrl: string, _channel: Channel): Promise<Buffer> {
    console.warn(`[ig] downloadMedia não implementado. ${STUB_MESSAGE}`);
    return Buffer.alloc(0);
  }

  async markAsRead(_externalId: string, _channel: Channel): Promise<void> {
    console.warn(`[ig] markAsRead não implementado. ${STUB_MESSAGE}`);
  }

  async sendTypingIndicator(
    _externalId: string,
    _kind: 'typing' | 'recording',
    _channel: Channel,
  ): Promise<void> {
    console.warn(`[ig] sendTypingIndicator não implementado. ${STUB_MESSAGE}`);
  }

  /** Resultado de envio padrão do STUB. */
  private notImplemented(method: string): SendResult {
    console.warn(`[ig] ${method} não implementado. ${STUB_MESSAGE}`);
    return {
      ok: false,
      errorCode: IG_NOT_IMPLEMENTED,
      errorMessage: `${method}: ${STUB_MESSAGE}`,
    };
  }
}
