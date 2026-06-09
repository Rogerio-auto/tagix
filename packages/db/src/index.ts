/**
 * @hm/db — DAL Drizzle sobre Postgres (Repository pattern; ADR-002/003).
 * Nenhuma chamada Supabase JS aqui — só Drizzle, para permitir trocar driver.
 */
export { createClient, getDb } from './client';
export type { DB, DbClient, Schema } from './client';
export * as schema from './schema';
export { RLS_TABLES } from './schema';
export { workspacesRepo, membersRepo } from './repos';

export const DB_PKG = '@hm/db' as const;
