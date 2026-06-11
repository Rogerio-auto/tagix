/**
 * Org structure (F8-S01): departments + teams + team_members + SLA rules.
 *
 * `departments`/`teams` não existiam até a F8 — `conversations.department_id`,
 * `conversations.team_id` e `calendars.team_id` eram uuid soltos esperando estas
 * tabelas. A migration custom adiciona as FKs (backfill) agora que existem.
 *
 * Hierarquia: workspace → departments → teams → team_members (membros). Um team
 * pode opcionalmente pertencer a um department; um member pode estar em vários
 * teams (join `team_members`).
 *
 * SLA: `sla_rules` (tabela, não jsonb) — uma regra por workspace+scope, com limites
 * em segundos para primeira resposta e resolução. Escolhi tabela em vez de coluna
 * jsonb em `workspaces` porque (a) o dashboard agrega `sla_violado_hoje` por
 * department/team (scope), (b) regras por escopo evoluem independentemente, e
 * (c) índice por workspace_id mantém o hot-path do refresh job barato.
 *
 * RLS: todas as 4 tabelas têm workspace_id próprio → isolamento direto. As policies
 * são aplicadas na migration custom (espelha o padrão dos demais domínios).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

// ─── departments ──────────────────────────────────────────────────────────────
export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    isActive: text('is_active').notNull().default('active'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_departments_workspace').on(t.workspaceId),
    unique('departments_workspace_name_uq').on(t.workspaceId, t.name),
    check('departments_is_active_chk', sql`${t.isActive} in ('active','archived')`),
  ],
);

// ─── teams ──────────────────────────────────────────────────────────────────
export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // department opcional — um team pode existir solto no workspace.
    departmentId: uuid('department_id').references((): AnyPgColumn => departments.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    description: text('description'),
    // auto-assign: round_robin | least_busy | manual (DASHBOARD §7 / PERMISSIONS §5).
    autoAssignStrategy: text('auto_assign_strategy').notNull().default('manual'),
    isActive: text('is_active').notNull().default('active'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_teams_workspace').on(t.workspaceId),
    index('idx_teams_department').on(t.departmentId).where(sql`${t.departmentId} is not null`),
    unique('teams_workspace_name_uq').on(t.workspaceId, t.name),
    check('teams_is_active_chk', sql`${t.isActive} in ('active','archived')`),
    check(
      'teams_auto_assign_chk',
      sql`${t.autoAssignStrategy} in ('round_robin','least_busy','manual')`,
    ),
  ],
);

// ─── team_members (join) ─────────────────────────────────────────────────────
// workspace_id denormalizado p/ RLS direta (espelha contact_tags). Casar com
// teams.workspace_id e members.workspace_id na escrita.
export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // 'lead' marca o responsável do team (supervisor); 'member' é atendente comum.
    role: text('role').notNull().default('member'),
    addedAt: ts('added_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.memberId] }),
    index('idx_team_members_member').on(t.memberId),
    index('idx_team_members_workspace').on(t.workspaceId),
    check('team_members_role_chk', sql`${t.role} in ('lead','member')`),
  ],
);

// ─── sla_rules ────────────────────────────────────────────────────────────────
// Uma regra por (workspace, scope_type, scope_id). scope_type='workspace' → scope_id
// NULL (regra default do workspace); 'department'/'team' → scope_id aponta a entidade.
// Limites em segundos; NULL = sem limite para aquela métrica.
export const slaRules = pgTable(
  'sla_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    scopeType: text('scope_type').notNull().default('workspace'),
    // Sem FK: scope_id pode apontar a department OU team conforme scope_type.
    scopeId: uuid('scope_id'),
    firstResponseSecs: integer('first_response_secs'),
    resolutionSecs: integer('resolution_secs'),
    isActive: text('is_active').notNull().default('active'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_sla_rules_workspace').on(t.workspaceId),
    // Uma regra por escopo. coalesce do scope_id num sentinela p/ unicidade do default.
    unique('sla_rules_workspace_scope_uq').on(t.workspaceId, t.scopeType, t.scopeId),
    check('sla_rules_scope_type_chk', sql`${t.scopeType} in ('workspace','department','team')`),
    check('sla_rules_is_active_chk', sql`${t.isActive} in ('active','archived')`),
    check(
      'sla_rules_scope_id_chk',
      sql`(${t.scopeType} = 'workspace' and ${t.scopeId} is null) or (${t.scopeType} <> 'workspace' and ${t.scopeId} is not null)`,
    ),
    check(
      'sla_rules_limits_chk',
      sql`(${t.firstResponseSecs} is null or ${t.firstResponseSecs} > 0) and (${t.resolutionSecs} is null or ${t.resolutionSecs} > 0)`,
    ),
  ],
);
