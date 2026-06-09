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
export const CHANNEL_PROVIDERS = ['meta_whatsapp', 'meta_instagram', 'waha'] as const;
export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];

// --- Auth (IAuthProvider) ---
export * from './auth';

// --- Tipos de mensagem interativa (LiveChat) ---
export * from './types/interactive';

export const SHARED_PKG = '@hm/shared' as const;
