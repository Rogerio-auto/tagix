/**
 * Entitlement overrides por workspace (PLATFORM_TENANT_MANAGEMENT §5.3).
 *
 * `workspace_entitlement_overrides` guarda os limites/features NÃO-IA que sobrepõem
 * o plano de um tenant ("custom plan": dar +5 canais a um cliente sem criar plano
 * novo). A IA (allowed_models/caps) já é override via `workspace_agent_policies`
 * (F25-S03); esta tabela cobre o resto (canais/membros/mensagens/features).
 *
 * `resolveEntitlements(workspaceId)` (F26-S04) = `plan.limits/features` MERGE este
 * override (override vence). É a fonte única lida por UI e (futuro) enforcement.
 *
 * **Workspace-scoped** (1 linha por workspace, PK = workspace_id) → RLS de tenant.
 * A plataforma lê/escreve como owner (gated por `requirePlatformAdmin`); o produto
 * lê dentro do `withWorkspace` do próprio tenant.
 */
import { jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const workspaceEntitlementOverrides = pgTable('workspace_entitlement_overrides', {
  /** 1:1 com workspace (PK = FK). */
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  /** Override de limites numéricos não-IA (ex.: max_channels, max_members). Merge sobre o plano. */
  limits: jsonb('limits').$type<Record<string, number>>().notNull().default({}),
  /** Override de flags de feature não-IA (ex.: instagram, flows, api_access). */
  features: jsonb('features').$type<Record<string, boolean>>().notNull().default({}),
  /** Super-admin que aplicou o override por último (auditoria). */
  updatedBy: uuid('updated_by').references(() => members.id, { onDelete: 'set null' }),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
