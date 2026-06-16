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

export const DB_PKG = '@hm/db' as const;
