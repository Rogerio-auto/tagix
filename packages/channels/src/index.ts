/**
 * @hm/channels — adapters de canais Meta (WhatsApp + Instagram) e WAHA.
 *
 * `IChannelAdapter` é a fronteira: o worker outbound roteia por provider e nunca
 * conhece detalhes da Meta Cloud API. Implementações: F1-S08 (WA), F1.5 (IG),
 * F1-S18 (WAHA).
 */

// --- Fronteira de canais (tipos canônicos — vide LIVECHAT.md §2.1) ---
export type {
  IChannelAdapter,
  AdapterCapabilities,
  InboundEvent,
  SendResult,
  Channel,
  MediaRef,
  MessageType,
  IgMessageTag,
  SendTextInput,
  SendMediaInput,
  SendTemplateInput,
  SendInteractiveInput,
  TemplateComponent,
} from './types';

/**
 * Input legado de envio de texto (skeleton F1-S01). Mantido por
 * compatibilidade; novos calls usam `SendTextInput`.
 */
export interface OutboundText {
  readonly to: string;
  readonly body: string;
}

// --- Infra compartilhada Graph/HMAC/erros ---
export {
  GraphClient,
  GRAPH_API_BASE,
  GRAPH_API_VERSION,
  type GraphClientOptions,
  type JsonBody,
} from './shared/graphClient';
export { verifyMetaSignature } from './shared/hmac';
export {
  MetaError,
  isRetryableStatus,
  type MetaErrorBody,
} from './shared/errors';

// --- Adapters ---
export { MetaWhatsAppAdapter } from './meta/whatsapp/adapter';
export { MetaInstagramAdapter } from './meta/instagram/adapter';
export { WAHAAdapter } from './waha/adapter';

export const CHANNELS_PKG = '@hm/channels' as const;
