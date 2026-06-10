/**
 * Dominio Pipeline / funil unificado (DATA_MODEL 10.1-10.5 + PIPELINE.md 3/4/8).
 * Tabelas: pipelines, stages, deals, deal_history, deal_attachments,
 * pending_automations (fila duravel, 3.3). SEM deal_tasks (DATA_MODEL 10.6).
 * Custom field defs em pipelines.settings.custom_fields[] (8.1); valores em
 * deals.custom_fields. Tipos jsonb fortes = contrato; validacao runtime e da API.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { contacts, conversations, members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export type CustomFieldDef = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean' | 'currency';
  required: boolean;
  options?: string[];
  defaultValue?: string | number | boolean | null;
  position: number;
};

export type PipelineSettings = {
  custom_fields?: CustomFieldDef[];
  [key: string]: unknown;
};

export type ConversionValueFrom = 'deal' | 'fixed' | string;

export type AutomationRuleConfig =
  | { kind: 'trigger_flow'; flowId: string }
  | { kind: 'send_message'; templateName: string; languageCode: string; channelId: string }
  | { kind: 'notify_members'; memberIds: string[]; title: string; body: string }
  | { kind: 'create_event'; calendarId: string; title: string; durationMinutes: number; offsetDays: number }
  | { kind: 'add_tag'; tagId: string }
  | { kind: 'remove_tag'; tagId: string }
  | { kind: 'register_conversion'; conversionTypeKey: string; valueFrom: ConversionValueFrom; valueCents?: number };

export type AutomationRule = {
  id: string;
  trigger: 'on_enter' | 'on_exit' | 'on_stale';
  staleAfterDays?: number;
  action:
    | 'trigger_flow'
    | 'send_message'
    | 'notify_members'
    | 'create_event'
    | 'add_tag'
    | 'remove_tag'
    | 'register_conversion';
  config: AutomationRuleConfig;
  delaySeconds: number;
  enabled: boolean;
};

export type TransitionRules = {
  allowedFromStageIds?: string[];
  requiredFields?: string[];
  requiredRoles?: Array<'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'AGENT'>;
  requiresApproval?: boolean;
};

export const pipelines = pgTable(
  'pipelines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    industry: text('industry'),
    settings: jsonb('settings').$type<PipelineSettings>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [index('idx_pipelines_workspace').on(t.workspaceId)],
);

export const stages = pgTable(
  'stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#1FFF13'),
    icon: text('icon'),
    position: integer('position').notNull(),
    isWon: boolean('is_won').notNull().default(false),
    isLost: boolean('is_lost').notNull().default(false),
    probability: numeric('probability', { precision: 5, scale: 2 }),
    automationRules: jsonb('automation_rules').$type<AutomationRule[]>().notNull().default([]),
    transitionRules: jsonb('transition_rules').$type<TransitionRules>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    unique('stages_pipeline_position_uq').on(t.pipelineId, t.position),
    index('idx_stages_pipeline').on(t.pipelineId, t.position),
  ],
);

export const deals = pgTable(
  'deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'cascade' }),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => stages.id, { onDelete: 'restrict' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    valueCents: bigint('value_cents', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull().default('BRL'),
    source: text('source'),
    ownerId: uuid('owner_id').references(() => members.id, { onDelete: 'set null' }),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    notes: text('notes'),
    position: integer('position').notNull().default(0),
    closedAt: ts('closed_at'),
    closedWon: boolean('closed_won'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_deals_workspace_pipeline_stage').on(
      t.workspaceId,
      t.pipelineId,
      t.stageId,
      t.position,
    ),
    index('idx_deals_contact').on(t.contactId),
    index('idx_deals_owner').on(t.ownerId).where(sql`${t.ownerId} is not null`),
  ],
);

export const dealHistory = pgTable(
  'deal_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    fromValue: jsonb('from_value').$type<Record<string, unknown>>(),
    toValue: jsonb('to_value').$type<Record<string, unknown>>(),
    actorMemberId: uuid('actor_member_id').references(() => members.id, { onDelete: 'set null' }),
    actorType: text('actor_type').notNull().default('member'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_deal_history_deal_created').on(t.dealId, t.createdAt.desc()),
    check(
      'deal_history_event_type_chk',
      sql`${t.eventType} in ('created','stage_changed','field_updated','owner_changed','closed','reopened','note_added','attachment_added')`,
    ),
    check('deal_history_actor_type_chk', sql`${t.actorType} in ('member','agent','system','api')`),
  ],
);

export const dealAttachments = pgTable(
  'deal_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    filename: text('filename'),
    caption: text('caption'),
    sha256: text('sha256').notNull(),
    gpsLat: numeric('gps_lat', { precision: 10, scale: 7 }),
    gpsLon: numeric('gps_lon', { precision: 10, scale: 7 }),
    gpsAltitude: numeric('gps_altitude', { precision: 8, scale: 2 }),
    gpsAccuracy: numeric('gps_accuracy', { precision: 8, scale: 2 }),
    capturedAt: ts('captured_at'),
    uploadedBy: uuid('uploaded_by').references(() => members.id, { onDelete: 'set null' }),
    indexNumber: integer('index_number'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_deal_attachments_deal').on(t.dealId, t.createdAt.desc())],
);

export const pendingAutomations = pgTable(
  'pending_automations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    rule: jsonb('rule').$type<AutomationRule>().notNull(),
    scheduledAt: ts('scheduled_at').notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    status: text('status').notNull().default('pending'),
    lastError: text('last_error'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_pending_automations_due').on(t.status, t.scheduledAt),
    check(
      'pending_automations_status_chk',
      sql`${t.status} in ('pending','processing','done','failed')`,
    ),
  ],
);
