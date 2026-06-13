/**
 * Impersonation / View-as (PLATFORM_TENANT_MANAGEMENT §6.1).
 *
 * `impersonation_sessions` registra cada vez que um super-admin entra no contexto
 * de um workspace para ver o produto pelos olhos do tenant. Nesta fase (F26) o modo
 * é **só `view` (read-only)** — o middleware bloqueia qualquer escrita. O enum modela
 * `view|act` para o futuro (act-as), mas um CHECK trava em `'view'` por enquanto.
 *
 * **Platform-level** (gerida só por super-admin via `requirePlatformAdmin`): assim como
 * `platform_secrets`/`webhook_events`, NÃO tem `workspace_id` próprio de isolamento
 * (o `target_workspace_id` é o ALVO, não o dono) → fica FORA do RLS de tenant. O guard
 * + a auditoria são a fronteira. Compliance LGPD: `reason` obrigatório, TTL via
 * `expires_at`, início/fim auditados em `audit_logs`.
 */
import { sql } from 'drizzle-orm';
import { check, index, inet, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const impersonationSessions = pgTable(
  'impersonation_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Super-admin que iniciou a sessão (member com is_platform_admin). */
    adminMemberId: uuid('admin_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    /** Workspace-alvo cujo contexto está sendo visualizado. */
    targetWorkspaceId: uuid('target_workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** F26: só `view` (read-only). Enum modela `act` p/ o futuro; CHECK trava em view. */
    mode: text('mode').notNull().default('view'),
    /** Motivo obrigatório (LGPD: justificativa de acesso a PID do titular). */
    reason: text('reason').notNull(),
    startedAt: ts('started_at').notNull().defaultNow(),
    /** TTL: a sessão expira automaticamente (o middleware ignora sessões vencidas). */
    expiresAt: ts('expires_at').notNull(),
    /** Preenchido ao encerrar manualmente (kill-switch) ou ao expirar/limpar. */
    endedAt: ts('ended_at'),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Hot-path: resolver sessão ativa do admin (não encerrada e não expirada).
    index('idx_impersonation_active')
      .on(t.adminMemberId, t.expiresAt)
      .where(sql`${t.endedAt} is null`),
    index('idx_impersonation_target').on(t.targetWorkspaceId),
    check('impersonation_sessions_mode_chk', sql`${t.mode} in ('view')`),
  ],
);
