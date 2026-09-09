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
  IInstagramAdapter,
  IgCommentReplyInput,
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
export { MetaError, isRetryableStatus, type MetaErrorBody } from './shared/errors';

// --- Parsers de webhook inbound (provider → InboundEvent[]) ---
export { parseWhatsAppWebhook } from './meta/whatsapp/webhook.parser';
export { parseWahaWebhook } from './waha/webhook.parser';
export { parseInstagramWebhook } from './meta/instagram/webhook.parser';

// --- Coexistência WhatsApp Business (F39-S03): parser + contrato p/ F39-S04 ---
export {
  parseCoexistence,
  hasCoexistenceFields,
  isCoexistenceField,
} from './meta/whatsapp/coexistence';
export type {
  CoexistenceParseResult,
  CoexistenceEcho,
  CoexistenceHistoryBatch,
  CoexistenceHistoryContact,
  CoexistenceHistoryMessage,
  CoexistenceAppState,
} from './meta/whatsapp/coexistence';

// --- Adapters ---
export { MetaWhatsAppAdapter } from './meta/whatsapp/adapter';
export { MetaInstagramAdapter } from './meta/instagram/adapter';
export { WAHAAdapter } from './waha/adapter';

// --- Instagram helpers (comments/stories/errors — F15-S01) ---
export {
  listComments,
  replyPublic as igReplyPublicToComment,
  replyPrivate as igReplyPrivateToComment,
  hideComment as igHideComment,
  deleteComment as igDeleteComment,
  type IgCommentSummary,
  type IgCommentActionResult,
} from './meta/instagram/comments';
export { downloadStoryMedia } from './meta/instagram/stories';
export {
  IG_ERROR_CODES,
  IG_ERROR_MESSAGES,
  IgInteractiveSerializeError,
  type IgErrorCode,
} from './meta/instagram/errors';

// --- Campaigns: error->action map + Graph quality/template helpers (F6-S02) ---
export {
  CAMPAIGN_ERROR_CODES,
  mapCampaignError,
  type CampaignErrorAction,
  type CampaignErrorInfo,
} from './meta/errors';
export {
  fetchChannelQuality,
  fetchMetaTemplate,
  type ChannelHealth,
  type QualityRating,
  type MetaTemplateInfo,
  type TemplateCategory,
  type TemplateStatus,
} from './meta/quality';

// --- Catalogo de modelos de mensagem WhatsApp (F58-S03) ---
export {
  MetaTemplatesClient,
  MetaTemplateError,
  validateMetaTemplateCreateInput,
  type MetaTemplatesClientOptions,
  type MetaTemplateErrorKind,
  type MetaTemplateErrorPermanence,
  type MetaTemplateValidationIssue,
  type CreateMetaTemplateArgs,
  type ListMetaTemplatesArgs,
  type MetaBodyComponent,
  type MetaButtonsComponent,
  type MetaFooterComponent,
  type MetaMediaHeaderComponent,
  type MetaMessageTemplate,
  type MetaPhoneNumberButton,
  type MetaQuickReplyButton,
  type MetaTemplateButton,
  type MetaTemplateCategory,
  type MetaTemplateCreateComponent,
  type MetaTemplateCreateInput,
  type MetaTemplateStatus,
  type MetaTextHeaderComponent,
  type MetaUrlButton,
} from './meta/templates';

export const CHANNELS_PKG = '@hm/channels' as const;

// Capacidades negociadas do adapter (F60-S01 — CANAIS_PLAN §3.1).
export {
  CHANNEL_CAPABILITIES,
  NO_LIMITS,
  capabilitiesFromLegacy,
  declareCapabilities,
} from './capabilities';
export type { ChannelCapability, ChannelLimits, DeclaredCapabilities } from './capabilities';

// Canal de e-mail (F60-S03 — CANAIS_PLAN §4).
export type {
  EmailAddress,
  EmailAttachment,
  EmailEvent,
  EmailEventKind,
  EmailStream,
  IEmailProvider,
  InboundEmail,
  SendEmailInput,
  SendEmailResult,
} from './email/provider';
export {
  buildReferences,
  normalizeMessageId,
  normalizeSubject,
  parseReferences,
  replySubject,
  threadKeyFrom,
} from './email/threading';
export { EmailChannelAdapter, EMAIL_CAPABILITIES } from './email/adapter';
export type { EmailAdapterOptions } from './email/adapter';
export { htmlToText, sanitizeEmailHtml } from './email/sanitize';
export { SOFT_BOUNCE_LIMIT, decideOnEmailEvent, resetsSoftBounces } from './email/bounce';
export type { BounceAction, BounceDecision } from './email/bounce';
export { FakeEmailProvider } from './email/fake-provider';
export type { FakeEmailProviderOptions, SentEmail } from './email/fake-provider';
