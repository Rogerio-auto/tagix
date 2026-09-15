/**
 * Conexão Meta por workspace (F69-S02 — META_INTEGRACAO_PLAN §5.6).
 *
 * Uma linha por pessoa que conectou a Meta num workspace. Guarda o token de
 * usuário de longa duração (cifrado), o que foi concedido e negado, e os ativos
 * que essa pessoa administra — para que uma ação que precisa de uma permissão
 * ausente diga qual falta, em vez de falhar no meio.
 *
 * ## Por que `meta_user_id` importa tanto
 *
 * É o identificador que a Meta usa nos callbacks de exclusão de dados e de
 * desautorização (F69-S01). Sem ele gravado aqui, esses callbacks não teriam o que
 * encontrar. Como o pedido chega sem workspace, a busca por ele atravessa tenants
 * — e por isso passa por funções `SECURITY DEFINER` mínimas (migration 0079), não
 * por uma leitura sem RLS.
 *
 * ## Revogar apaga o token
 *
 * `access_token_enc` é anulável de propósito: conexão revogada fica registrada
 * (para a tela explicar o que aconteceu), mas sem token nenhum guardado.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export interface MetaConnectionAssets {
  pages: Array<{ id: string; name: string | null; instagram: { id: string; username: string | null } | null }>;
  adAccounts: Array<{ id: string; name: string | null; currency: string | null }>;
}

export type MetaConnectionStatus = 'active' | 'revoked';

export const metaConnections = pgTable(
  'meta_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** ID do usuário com escopo do app — o mesmo que chega nos callbacks da F69-S01. */
    metaUserId: text('meta_user_id').notNull(),
    metaUserName: text('meta_user_name'),
    /** Token de usuário de longa duração, cifrado. Nulo quando revogado. */
    accessTokenEnc: text('access_token_enc'),
    keyVersion: integer('key_version').notNull().default(1),
    tokenExpiresAt: ts('token_expires_at'),
    useCases: jsonb('use_cases').$type<string[]>().notNull().default([]),
    grantedPermissions: jsonb('granted_permissions').$type<string[]>().notNull().default([]),
    declinedPermissions: jsonb('declined_permissions').$type<string[]>().notNull().default([]),
    assets: jsonb('assets')
      .$type<MetaConnectionAssets>()
      .notNull()
      .default({ pages: [], adAccounts: [] }),
    status: text('status').$type<MetaConnectionStatus>().notNull().default('active'),
    connectedBy: uuid('connected_by').references(() => members.id, { onDelete: 'set null' }),
    lastCheckedAt: ts('last_checked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    // Reconectar a mesma pessoa no mesmo workspace atualiza, não duplica.
    uniqueIndex('uq_meta_connections_workspace_user').on(t.workspaceId, t.metaUserId),
    // Hot path dos callbacks de exclusão e desautorização.
    index('idx_meta_connections_user').on(t.metaUserId),
    check('meta_connections_status_chk', sql`${t.status} in ('active','revoked')`),
    // Conexão ativa sem token é estado impossível: ou tem token, ou foi revogada.
    check(
      'meta_connections_token_chk',
      sql`${t.status} = 'revoked' or ${t.accessTokenEnc} is not null`,
    ),
  ],
);

export type MetaConnection = typeof metaConnections.$inferSelect;
