/**
 * Schema base da plataforma (DATA_MODEL.md §3, §13, §14).
 * Tabelas-base da F0. Domínios de produto (channels, conversations, etc.) entram em F1+.
 *
 * `citext` para emails (case-insensitive) — a extensão é criada no migrate.ts.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true });

// ─── Billing (§13) ──────────────────────────────────────────────────────────
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  priceMonthlyCents: bigint('price_monthly_cents', { mode: 'number' }).notNull().default(0),
  priceYearlyCents: bigint('price_yearly_cents', { mode: 'number' }).notNull().default(0),
  limits: jsonb('limits').$type<Record<string, number>>().notNull().default({}),
  features: jsonb('features').$type<Record<string, boolean>>().notNull().default({}),
  stripeProductId: text('stripe_product_id'),
  stripeMonthlyPriceId: text('stripe_monthly_price_id'),
  stripeYearlyPriceId: text('stripe_yearly_price_id'),
  isActive: boolean('is_active').notNull().default(true),
  position: integer('position').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ─── Platform (§3) ───────────────────────────────────────────────────────────
export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    industry: text('industry'),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    locale: text('locale').notNull().default('pt-BR'),
    logoUrl: text('logo_url'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    trialEndsAt: ts('trial_ends_at'),
    subscriptionStatus: text('subscription_status').notNull().default('trial'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_workspaces_subscription_status').on(t.subscriptionStatus),
    check(
      'workspaces_subscription_status_chk',
      sql`${t.subscriptionStatus} in ('trial','active','past_due','canceled','expired')`,
    ),
  ],
);

export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    authUserId: uuid('auth_user_id').notNull(),
    email: citext('email').notNull(),
    name: text('name'),
    phone: text('phone'),
    avatarUrl: text('avatar_url'),
    role: text('role').notNull(),
    status: text('status').notNull().default('invited'),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    themePreference: text('theme_preference').default('dark'),
    dashboardLayout: jsonb('dashboard_layout').$type<Record<string, unknown>>().notNull().default({}),
    notificationPrefs: jsonb('notification_prefs')
      .$type<{ in_app: boolean; email: boolean; push: boolean }>()
      .notNull()
      .default({ in_app: true, email: true, push: false }),
    densityPreference: text('density_preference').default('comfortable'),
    localeOverride: text('locale_override'),
    isOnline: boolean('is_online').notNull().default(false),
    lastSeenAt: ts('last_seen_at'),
    invitedBy: uuid('invited_by').references((): AnyPgColumn => members.id, { onDelete: 'set null' }),
    invitedAt: ts('invited_at'),
    joinedAt: ts('joined_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_members_workspace').on(t.workspaceId),
    index('idx_members_auth_user').on(t.authUserId),
    index('idx_members_role').on(t.workspaceId, t.role),
    unique('members_workspace_auth_user_uq').on(t.workspaceId, t.authUserId),
    unique('members_workspace_email_uq').on(t.workspaceId, t.email),
    check('members_role_chk', sql`${t.role} in ('OWNER','ADMIN','SUPERVISOR','AGENT','READONLY')`),
    check('members_status_chk', sql`${t.status} in ('invited','active','inactive','blocked')`),
    check('members_theme_chk', sql`${t.themePreference} in ('dark','light','system')`),
    check('members_density_chk', sql`${t.densityPreference} in ('comfortable','compact')`),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    keyPrefix: text('key_prefix').notNull(),
    scopes: text('scopes').array().notNull().default(sql`'{}'`),
    rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(60),
    isActive: boolean('is_active').notNull().default(true),
    lastUsedAt: ts('last_used_at'),
    expiresAt: ts('expires_at'),
    createdBy: uuid('created_by').references(() => members.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('idx_api_keys_workspace').on(t.workspaceId)],
);

// ─── Billing: subscriptions (§13.2) ──────────────────────────────────────────
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .unique()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('trial'),
    billingCycle: text('billing_cycle').notNull().default('monthly'),
    trialEndsAt: ts('trial_ends_at'),
    currentPeriodStart: ts('current_period_start'),
    currentPeriodEnd: ts('current_period_end'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    canceledAt: ts('canceled_at'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeLatestInvoiceId: text('stripe_latest_invoice_id'),
    customLimits: jsonb('custom_limits').$type<Record<string, number>>(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_subscriptions_status').on(t.status),
    check('subscriptions_status_chk', sql`${t.status} in ('trial','active','past_due','canceled','expired')`),
    check('subscriptions_cycle_chk', sql`${t.billingCycle} in ('monthly','yearly')`),
  ],
);

// ─── Audit (§14.1) ────────────────────────────────────────────────────────────
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    actorMemberId: uuid('actor_member_id').references(() => members.id, { onDelete: 'set null' }),
    actorType: text('actor_type').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_audit_logs_workspace_created').on(t.workspaceId, t.createdAt),
    index('idx_audit_logs_actor_created').on(t.actorMemberId, t.createdAt),
    check(
      'audit_logs_actor_type_chk',
      sql`${t.actorType} in ('member','agent','api','system','platform_admin')`,
    ),
  ],
);

// Canais de mensageria (F1).
export * from './channels';
// Segredos de plataforma (sem workspace_id → fora do RLS de tenant).
export * from './platform_secrets';
// Dedup de webhooks inbound na borda (platform-level, fora do RLS de tenant).
export * from './webhook_events';
// LiveChat: contacts → conversations → messages (ordem de dependência).
export * from './contacts';
export * from './conversations';
export * from './messages';
// Notas internas por conversa (+ mentions → notificação). Depende de conversations/members.
export * from './conversation_notes';
// Histórico auditável de roteamento (assign/transfer). Depende de conversations/members.
export * from './routing_history';
// Instagram comments (auxiliar, F1.5).
export * from './ig_comments';

// ─── Agents domain (F2 §7) ───────────────────────────────────────────────────
// Templates + tools são catálogos GLOBAIS (sem RLS de tenant); o resto é
// workspace-scoped. Ordem: catálogos globais → agents → junções/logs/usage.
export * from './agent_templates'; // agent_templates, agent_template_questions (global)
export * from './agents'; // agents, agent_metrics, workspace_agent_policies (tenant)
export * from './agent_tools'; // tools (global), agent_tools, tool_logs (tenant)
export * from './agent_executions'; // agent_executions (tenant)
export * from './llm'; // llm_usage_logs (tenant), llm_models_whitelist (global)

// ─── Knowledge Base domain (F3 §8) ───────────────────────────────────────────
// kb_documents/kb_chunks(pgvector)/kb_feedback — todos workspace-scoped (RLS).
export * from './knowledge'; // kb_documents, kb_chunks, kb_feedback (tenant)

// --- Flow Builder domain (F4 par.9) ---
// flows/flow_executions/flow_logs/flow_submissions sao workspace-scoped (RLS direto).
// flow_versions nao tem workspace_id proprio: RLS via subquery em flows.
export * from './flows'; // flows, flow_versions, flow_executions, flow_logs, flow_submissions

/** Tabelas com `workspace_id` que recebem RLS. */
export const RLS_TABLES = [
  'workspaces',
  'members',
  'api_keys',
  'subscriptions',
  'audit_logs',
  'channels',
  'channel_secrets',
  'contacts',
  'conversations',
  'messages',
  'conversation_notes',
  'routing_history',
  'ig_comments',
  // Agents domain (workspace-scoped). `agent_tools` é isolada via subquery em
  // `agents` (não tem workspace_id próprio) — ver migration RLS dedicada.
  'agents',
  'agent_metrics',
  'workspace_agent_policies',
  'agent_tools',
  'tool_logs',
  'agent_executions',
  'llm_usage_logs',
  // Knowledge Base domain (workspace-scoped).
  'kb_documents',
  'kb_chunks',
  'kb_feedback',
  // Flow Builder (workspace-scoped). flow_versions sem workspace_id proprio:
  // isolada via subquery em flows (ver migration RLS dedicada).
  'flows',
  'flow_executions',
  'flow_logs',
  'flow_submissions',
] as const;
