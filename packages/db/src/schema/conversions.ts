/**
 * Sistema de Conversoes (DATA_MODEL 10.7 + DASHBOARD.md 13).
 *
 * conversion_types  -- catalogo por workspace (slug + label + value_required...).
 * conversion_events -- registros com atribuicao multi-fonte (member/agent/flow/
 *                      campaign/channel). So uma FK de atribuicao costuma estar
 *                      preenchida por evento. deal_id e ON DELETE SET NULL
 *                      (conversao sobrevive ao deal).
 * conversion_tag_triggers -- tag -> conversao automatica (trigger pg em F5-S14).
 *
 * NOTA: attributed_campaign_id e uuid SEM FK -- a tabela `campaigns` (DATA_MODEL
 * 11) ainda nao existe (fase futura). Vira FK quando campaigns for criada.
 *
 * Indices funcionais (dedup same-day via date_trunc + parciais de atribuicao)
 * vivem na migration custom 00xx_conversions_rls.sql (drizzle-kit nao expressa
 * date_trunc/partial-where via schema).
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { channels } from './channels';
import { contacts, conversations } from './index';
import { deals } from './pipeline';
import { flows } from './flows';
import { members, workspaces } from './index';
import { tags } from './tags';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const conversionTypes = pgTable(
  'conversion_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    color: text('color').notNull().default('#1FFF13'),
    icon: text('icon'),
    valueRequired: boolean('value_required').notNull().default(false),
    valueLabel: text('value_label'),
    currency: text('currency').notNull().default('BRL'),
    isDefault: boolean('is_default').notNull().default(false),
    position: integer('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [unique('conversion_types_workspace_key_uq').on(t.workspaceId, t.key)],
);

export const conversionEvents = pgTable(
  'conversion_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    conversionTypeId: uuid('conversion_type_id')
      .notNull()
      .references(() => conversionTypes.id, { onDelete: 'restrict' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    // Conversao sobrevive ao deal.
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    valueCents: bigint('value_cents', { mode: 'number' }),
    currency: text('currency').notNull().default('BRL'),
    note: text('note'),
    source: text('source').notNull(),
    triggeredByMemberId: uuid('triggered_by_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),
    triggeredByAgentId: uuid('triggered_by_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    triggeredByFlowId: uuid('triggered_by_flow_id').references(() => flows.id, {
      onDelete: 'set null',
    }),
    // SEM FK: campaigns (DATA_MODEL 11) ainda nao existe. Vira FK em fase futura.
    attributedCampaignId: uuid('attributed_campaign_id'),
    attributedChannelId: uuid('attributed_channel_id').references(() => channels.id, {
      onDelete: 'set null',
    }),
    attributionWindowDays: integer('attribution_window_days').notNull().default(30),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    cancelledAt: ts('cancelled_at'),
    cancelledReason: text('cancelled_reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'conversion_events_source_chk',
      sql`${t.source} in ('manual','deal_won','tag_added','agent_tool','api','webhook','flow')`,
    ),
    // Indices parciais de atribuicao + dedup same-day: migration custom (date_trunc).
  ],
);

export const conversionTagTriggers = pgTable(
  'conversion_tag_triggers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    conversionTypeId: uuid('conversion_type_id')
      .notNull()
      .references(() => conversionTypes.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('conversion_tag_triggers_uq').on(t.workspaceId, t.tagId, t.conversionTypeId),
    index('idx_conversion_tag_triggers_tag').on(t.tagId),
  ],
);
