/**
 * @hm/db — DAL Drizzle sobre Postgres (Repository pattern; ADR-002/003).
 * Nenhuma chamada Supabase JS aqui — só Drizzle, para permitir trocar driver.
 */
export { createClient, getDb, closeDb } from './client';
export type { DB, DbClient, DbTx, Schema } from './client';
export { withWorkspace } from './rls';
export { encryptSecret, decryptSecret } from './crypto';
export * as schema from './schema';
export { RLS_TABLES } from './schema';
export { workspacesRepo, membersRepo } from './repos';
export { paymentEventsRepo } from './repos/payment-events';
export type { PaymentEvent, NewPaymentEvent } from './schema/billing';
export {
  contactsRepo,
  conversationsRepo,
  messagesRepo,
  buildVisibilityPredicate,
  assertConversationVisible,
  resolvePeerVisibility,
  pickAutoAssignee,
} from './repos/livechat';
export type { VisibilityContext, PeerVisibilityInput, AutoAssignInput, AutoAssignStrategy } from './repos/livechat';
export { dataExportJobsRepo, type DataExportJob } from './repos/privacy';
export type { DataExportScope } from './schema/privacy';
// Platform tenant management (F26-S01).
export { impersonationSessionsRepo, type ImpersonationSession } from './repos/impersonation';
export {
  entitlementOverridesRepo,
  type WorkspaceEntitlementOverride,
} from './repos/entitlements';
// Agent ↔ department routing (F34-S01).
export {
  agentDepartmentsRepo,
  type AgentDepartment,
  type AgentDepartmentItem,
  type DepartmentLink,
  type AgentLink,
} from './repos/agent_departments';
// Calendar 2.0: provisionamento + acesso (F37-S01) + criação de evento (F53-S08:
// núcleo único de persistência reusado por API e worker).
export {
  calendarRepo,
  CalendarNotFoundError,
  type Calendar,
  type CalendarAccessContext,
  type CreateEventInput,
  type Event,
  type EventPriority,
} from './repos/calendar';
// Central de Ajuda (F38-S01).
export {
  helpRepo,
  type HelpCategory,
  type HelpArticle,
  type HelpArticleFeedback,
  type HelpArticleSummary,
} from './repos/help';
// Chat de Suporte (F38-S01).
export {
  supportRepo,
  type SupportThread,
  type SupportMessage,
  type SupportThreadStatus,
  type SupportThreadPriority,
  type SupportSenderType,
  type PlatformThreadFilters,
} from './repos/support';
export type { SupportAttachment } from './schema/support';
// Onboarding & verticalização (F43-S01 estado/repo, F43-S02 engine, F43-S03 registry).
// Exposto no barrel para os consumidores da API (F43-S04+) sem deep-import no src.
export {
  onboardingRepo,
  type WorkspaceOnboarding,
  type MemberTourState,
  type TourEntry,
} from './repos/onboarding';
export { instantiateNicheBlueprint } from './seed/niches/instantiate';
// Provisionamento self-serve (F44-S02): cria workspace + owner (sem platform admin)
// + subscription trial free, idempotente. Caminho privilegiado isolado.
export {
  provisionWorkspaceWithOwner,
  type ProvisionWorkspaceInput,
  type ProvisionWorkspaceResult,
  slugifyWorkspaceName,
  slugCandidate,
} from './provisioning';

export { getBlueprint, isNicheKey, NICHE_KEYS, type NicheKey } from './seed/niches';
export type { NicheBlueprint, InstantiateResult } from './seed/niches/types';

export const DB_PKG = '@hm/db' as const;
