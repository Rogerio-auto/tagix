/**
 * Dominio Campaigns (DATA_MODEL 11 + CAMPAIGNS.md 8.4).
 * idempotency_key UNIQUE = sha256(campaignId:recipientId:stepId): re-tick NUNCA duplica.
 * scheduled_followups e fila DURAVEL (8.4) que sobrevive a crash.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { channels } from './channels';
import { contacts, members, messages, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export interface SendWindows {
  readonly enabled: boolean;
  readonly timezone?: string;
  readonly windows?: ReadonlyArray<{
    readonly day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    readonly start: string;
    readonly end: string;
  }>;
}

export type TemplateComponents = ReadonlyArray<Record<string, unknown>>;

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull().default('draft'),
    startAt: ts('start_at'),
    endAt: ts('end_at'),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    sendWindows: jsonb('send_windows').$type<SendWindows>().notNull().default({ enabled: false }),
    rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(30),
    dailyLimit: integer('daily_limit').default(1000),
    messagesSentToday: integer('messages_sent_today').notNull().default(0),
    lastDailyResetAt: ts('last_daily_reset_at'),
    nextTickAt: ts('next_tick_at'),
    autoHandoffOnReply: boolean('auto_handoff_on_reply').notNull().default(true),
    aiHandoffAgentId: uuid('ai_handoff_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    segmentId: uuid('segment_id'),
    createdBy: uuid('created_by').references(() => members.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_campaigns_workspace_status').on(t.workspaceId, t.status),
    check('campaigns_type_chk', sql`${t.type} in ('broadcast','drip','triggered')`),
    check('campaigns_status_chk', sql`${t.status} in ('draft','scheduled','running','paused','completed','cancelled')`),
  ],
);

export const campaignSteps = pgTable(
  'campaign_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    templateName: text('template_name').notNull(),
    languageCode: text('language_code').notNull().default('pt_BR'),
    templateComponents: jsonb('template_components')
      .$type<TemplateComponents>()
      .notNull()
      .default([]),
    delaySeconds: integer('delay_seconds').notNull().default(0),
    stopOnReply: boolean('stop_on_reply').notNull().default(true),
  },
  (t) => [unique('campaign_steps_position_uq').on(t.campaignId, t.position)],
);

export const campaignRecipients = pgTable(
  'campaign_recipients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    lastStepIndex: integer('last_step_index').default(-1),
    lastStepAt: ts('last_step_at'),
    responded: boolean('responded').notNull().default(false),
    respondedAt: ts('responded_at'),
    failedReason: text('failed_reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_campaign_recipients_status').on(t.campaignId, t.status),
    unique('campaign_recipients_campaign_contact_uq').on(t.campaignId, t.contactId),
    check('campaign_recipients_status_chk', sql`${t.status} in ('pending','sending','completed','responded','failed','opted_out')`),
  ],
);

export const campaignDeliveries = pgTable(
  'campaign_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => campaignRecipients.id, { onDelete: 'cascade' }),
    stepId: uuid('step_id')
      .notNull()
      .references(() => campaignSteps.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    externalId: text('external_id'),
    status: text('status').notNull().default('queued'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    queuedAt: ts('queued_at').notNull().defaultNow(),
    sentAt: ts('sent_at'),
    deliveredAt: ts('delivered_at'),
    readAt: ts('read_at'),
    failedAt: ts('failed_at'),
  },
  (t) => [
    index('idx_campaign_deliveries_campaign_status').on(t.campaignId, t.status),
    check('campaign_deliveries_status_chk', sql`${t.status} in ('queued','sent','delivered','read','failed','blocked')`),
  ],
);

export const campaignMetrics = pgTable(
  'campaign_metrics',
  {
    campaignId: uuid('campaign_id')
      .primaryKey()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    totalRecipients: integer('total_recipients').notNull().default(0),
    messagesQueued: integer('messages_queued').notNull().default(0),
    messagesSent: integer('messages_sent').notNull().default(0),
    messagesDelivered: integer('messages_delivered').notNull().default(0),
    messagesRead: integer('messages_read').notNull().default(0),
    messagesReplied: integer('messages_replied').notNull().default(0),
    messagesFailed: integer('messages_failed').notNull().default(0),
    messagesBlocked: integer('messages_blocked').notNull().default(0),
    deliveryRate: numeric('delivery_rate', { precision: 5, scale: 2 }),
    readRate: numeric('read_rate', { precision: 5, scale: 2 }),
    responseRate: numeric('response_rate', { precision: 5, scale: 2 }),
    blockRate: numeric('block_rate', { precision: 5, scale: 2 }),
    healthStatus: text('health_status').notNull().default('healthy'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('campaign_metrics_health_chk', sql`${t.healthStatus} in ('healthy','warning','critical')`),
  ],
);

export const campaignFollowups = pgTable(
  'campaign_followups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    triggerEvent: text('trigger_event').notNull(),
    delayMinutes: integer('delay_minutes').notNull().default(60),
    templateName: text('template_name').notNull(),
    languageCode: text('language_code').notNull().default('pt_BR'),
    templateComponents: jsonb('template_components')
      .$type<TemplateComponents>()
      .notNull()
      .default([]),
    position: integer('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    unique('campaign_followups_position_uq').on(t.campaignId, t.position),
    check('campaign_followups_trigger_chk', sql`${t.triggerEvent} in ('on_reply','on_no_reply','on_delivered')`),
  ],
);

export const scheduledFollowups = pgTable(
  'scheduled_followups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => campaignRecipients.id, { onDelete: 'cascade' }),
    followupId: uuid('followup_id')
      .notNull()
      .references(() => campaignFollowups.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('scheduled'),
    scheduledAt: ts('scheduled_at').notNull(),
    processedAt: ts('processed_at'),
    failedReason: text('failed_reason'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_scheduled_followups_due').on(t.status, t.scheduledAt),
    unique('scheduled_followups_recipient_followup_uq').on(t.recipientId, t.followupId),
    check('scheduled_followups_status_chk', sql`${t.status} in ('scheduled','processing','sent','failed','cancelled')`),
  ],
);
