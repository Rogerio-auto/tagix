/**
 * @hm/db — schema Drizzle + repositories (Repository pattern sobre Postgres).
 *
 * F0-S03 adiciona o schema base (workspaces, members, plans, subscriptions,
 * audit_logs) + migrations + seed. F0-S04 adiciona RLS. Nenhuma chamada Supabase
 * JS no backend — a DAL é Drizzle, para permitir migração futura sem reescrever.
 */

import type { WorkspaceId } from '@hm/shared';

/** Contrato mínimo de um repository com escopo de tenant (RLS reforça no banco). */
export interface ScopedRepository {
  readonly workspaceId: WorkspaceId;
}

export const DB_PKG = '@hm/db' as const;
