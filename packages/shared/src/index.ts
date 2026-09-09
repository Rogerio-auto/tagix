/**
 * @hm/shared — tipos, schemas Zod e contratos compartilhados entre todos os apps.
 *
 * Cresce ao longo do roadmap (DATA_MODEL.md, PERMISSIONS.md). Este módulo é a
 * fonte única de verdade para tipos cross-cutting: IDs, roles, providers.
 */

// --- IDs branded (evita misturar ids de domínios diferentes em tempo de compilação) ---
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type MemberId = Brand<string, 'MemberId'>;
export type ContactId = Brand<string, 'ContactId'>;
export type ConversationId = Brand<string, 'ConversationId'>;

// --- Roles + matriz de permissões (PERMISSIONS.md) ---
export * from './permissions';

// --- Providers de canal (vide LIVECHAT.md / INSTAGRAM.md) ---
// `email` entra na F60-S03. A ordem importa pouco, mas a lista e consumida por
// `channels_provider_chk` no banco e pela trava de compilacao em `markets.ts`,
// que exige todo provider ser um `ChannelKind` valido.
export const CHANNEL_PROVIDERS = ['meta_whatsapp', 'meta_instagram', 'waha', 'email'] as const;
export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];

// --- Market packs: regra por mercado (BR/US) — AGENCIA_PLAN.md §3.1 ---
// Fonte única de moeda, idioma, fuso, canais e política de outbound. Nenhuma
// regra de conformidade vive fora deste módulo.
export * from './markets';

// --- Portão de envio: decide se a mensagem pode sair (F59-S04) ---
export * from './consent';

// --- Detector de revogacao em linguagem natural (F59-S06) ---
export * from './revocation';

// --- Auth (IAuthProvider) ---
export * from './auth';

// --- Tipos de mensagem interativa (LiveChat) ---
export * from './types/interactive';

// --- Payloads de mensagens ricas: location/contact/reaction (F45 — RICH_COMPOSER) ---
export {
  latitudeSchema,
  longitudeSchema,
  locationPayloadSchema,
  contactPhoneSchema,
  contactCardSchema,
  contactsPayloadSchema,
  reactionEmojiSchema,
  reactionPayloadSchema,
} from './messaging-payloads';
export type {
  LocationPayload,
  ContactCard,
  ContactsPayload,
  ReactionPayload,
} from './messaging-payloads';

// --- Contratos de Inbox/visibilidade + handoff de IA (F30 / LIVECHAT_OPS) ---
export * from './types/inbox';

// --- Eventos Socket.io Server→Client (LIVECHAT.md §6, tipos puros) ---
export * from './socket-events';

// --- Prévia da última mensagem (F61-S12). Fonte ÚNICA: havia 4 cópias, 3 erradas. ---
export { previewFor, humanizePreview, labelForType } from './preview';

// --- Telefone em formato humano (F61-S12). ---
export { formatPhoneForDisplay } from './phone-display';

// --- Central de Ajuda (F38 — SUPPORT.md §1). Exports explícitos (sem `export *`). ---
export {
  HELP_ARTICLE_STATUSES,
  helpCategoryInputSchema,
  helpCategoryPatchSchema,
  helpArticleInputSchema,
  helpArticlePatchSchema,
  helpReorderSchema,
  helpFeedbackSchema,
  helpArticlesQuerySchema,
} from './help';
export type {
  HelpArticleStatus,
  HelpCategoryInput,
  HelpCategoryPatch,
  HelpArticleInput,
  HelpArticlePatch,
  HelpReorderInput,
  HelpFeedbackInput,
  HelpArticlesQuery,
  HelpCategoryDTO,
  HelpCategoryWithCountDTO,
  HelpArticleSummaryDTO,
  HelpArticleDTO,
} from './help';

// --- Chat de Suporte (F38 — SUPPORT.md §2). Exports explícitos. ---
export {
  SUPPORT_THREAD_STATUSES,
  SUPPORT_THREAD_PRIORITIES,
  SUPPORT_SENDER_TYPES,
  supportOpenThreadSchema,
  supportSendMessageSchema,
  supportPlatformFiltersSchema,
  supportPlatformPatchSchema,
} from './support';
export type {
  SupportThreadStatusT,
  SupportThreadPriorityT,
  SupportSenderTypeT,
  SupportOpenThreadInput,
  SupportSendMessageInput,
  SupportPlatformFilters,
  SupportPlatformPatch,
  SupportThreadDTO,
  SupportMessageDTO,
} from './support';

// --- Rede: guarda anti-SSRF p/ destinos outbound de tenant (F56-S07). ---
//     NÃO re-exportado aqui: `ssrf-guard` importa `node:dns`/`node:http(s)` e o
//     bundler do browser resolve o import dinâmico em build-time, quebrando todo
//     client component que toque este barrel. Consuma pelo leaf: `@hm/shared/net`.

export const SHARED_PKG = '@hm/shared' as const;
