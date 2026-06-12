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
export { contactsRepo, conversationsRepo, messagesRepo } from './repos/livechat';
export { dataExportJobsRepo, type DataExportJob } from './repos/privacy';
export type { DataExportScope } from './schema/privacy';

export const DB_PKG = '@hm/db' as const;
