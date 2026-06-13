/**
 * Inbox visibility (F30 — LIVECHAT_OPS.md §1). Modelo de privacidade em DOIS eixos:
 *
 *  - Eixo 1 (entre escopos): quais departamentos/times o membro enxerga. Default por
 *    role (derivado em código) + override explícito por membro (`member_visibility_overrides`).
 *  - Eixo 2 (entre colegas, dentro do escopo): `shared` (todos do escopo veem tudo) vs
 *    `private` (cada um só as suas). Default no workspace (`inbox_visibility_settings`),
 *    override por time em `teams.peer_visibility`.
 *
 * RLS: ambas têm `workspace_id` próprio → isolamento direto. Policies na migration custom.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { departments, members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

// ─── inbox_visibility_settings ─────────────────────────────────────────────────
// 1 linha por workspace (workspace_id UNIQUE). Defaults de role são derivados em
// código; `role_overrides` fica reservado (jsonb) para granularidade futura.
export const inboxVisibilitySettings = pgTable(
  'inbox_visibility_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .unique()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Default de privacidade entre colegas no workspace inteiro (eixo 2).
    defaultPeerVisibility: text('default_peer_visibility').notNull().default('shared'),
    // READONLY enxerga toda a inbox (leitura) quando true.
    readonlySeesAll: boolean('readonly_sees_all').notNull().default(true),
    // Reservado: overrides finos por role (ex.: { "AGENT": "private" }).
    roleOverrides: jsonb('role_overrides').$type<Record<string, string>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_inbox_visibility_settings_workspace').on(t.workspaceId),
    check(
      'inbox_visibility_settings_peer_chk',
      sql`${t.defaultPeerVisibility} in ('shared','private')`,
    ),
  ],
);

// ─── member_visibility_overrides ───────────────────────────────────────────────
// Concede a um membro visibilidade extra sobre um departamento, além dos seus.
// workspace_id denormalizado p/ RLS direta (espelha team_members/contact_tags).
export const memberVisibilityOverrides = pgTable(
  'member_visibility_overrides',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id')
      .notNull()
      .references((): AnyPgColumn => departments.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.memberId, t.departmentId] }),
    index('idx_member_visibility_overrides_member').on(t.memberId),
    index('idx_member_visibility_overrides_department').on(t.departmentId),
    unique('member_visibility_overrides_uq').on(t.memberId, t.departmentId),
  ],
);
