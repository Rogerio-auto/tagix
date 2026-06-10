/**
 * Flow Builder domain — engine deterministica de automacao visual (DATA_MODEL §9).
 *
 * - flows (workspace-scoped -> RLS): definicao editavel. nodes/edges sao jsonb (array de
 *   FlowNode/FlowEdge), forma forte validada em runtime pelo @hm/flow-engine (F4-S02).
 *   Indice parcial idx_flows_trigger_type so para status='active' (hot-path dispatcher).
 * - flow_versions (sem workspace_id proprio -> RLS via subquery em flows): snapshot imutavel
 *   ao publicar. Execucoes em curso referenciam o flow_version_id ativo quando dispararam.
 * - flow_executions (workspace-scoped -> RLS): flow_version_id e ON DELETE RESTRICT (referencia
 *   a VERSION, nao o flow). idx_flow_executions_status_next (parcial waiting+timer) e o
 *   hot-path do scheduler (F4-S03).
 * - flow_logs (workspace-scoped -> RLS): trilha por no.
 * - flow_submissions (workspace-scoped -> RLS): respostas de Meta Flows (F4-S14).
 *
 * Nomes de tabela/coluna sao CONTRATO (consumidos por @hm/flow-engine, API, worker).
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
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { channels } from './channels';
import { contacts } from './contacts';
import { conversations } from './conversations';
import { members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Tipos de gatilho. stage_change/tag_added sao stub-ate-F5. */
export const TRIGGER_TYPES = [
  'manual',
  'stage_change',
  'tag_added',
  'keyword',
  'new_lead',
  'new_message',
  'system_event',
  'flow_submission',
] as const;

export const flows = pgTable(
  'flows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('draft'),
    triggerType: text('trigger_type').notNull(),
    triggerConfig: jsonb('trigger_config').$type<Record<string, unknown>>().notNull().default({}),
    filterStatus: text('filter_status').array(),
    filterStageIds: uuid('filter_stage_ids').array(),
    filterTagIds: uuid('filter_tag_ids').array(),
    channelIds: uuid('channel_ids').array(),
    nodes: jsonb('nodes').$type<unknown[]>().notNull().default([]),
    edges: jsonb('edges').$type<unknown[]>().notNull().default([]),
    schemaVersion: integer('schema_version').notNull().default(1),
    manualPosition: integer('manual_position'),
    createdBy: uuid('created_by').references(() => members.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_flows_workspace_status').on(t.workspaceId, t.status),
    index('idx_flows_trigger_type')
      .on(t.workspaceId, t.triggerType)
      .where(sql`${t.status} = 'active'`),
    check('flows_status_chk', sql`${t.status} in ('draft','active','paused','archived')`),
    check(
      'flows_trigger_type_chk',
      sql`${t.triggerType} in ('manual','stage_change','tag_added','keyword','new_lead','new_message','system_event','flow_submission')`,
    ),
  ],
);

export const flowVersions = pgTable(
  'flow_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flows.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    nodes: jsonb('nodes').$type<unknown[]>().notNull(),
    edges: jsonb('edges').$type<unknown[]>().notNull(),
    triggerConfig: jsonb('trigger_config').$type<Record<string, unknown>>().notNull(),
    publishedBy: uuid('published_by').references(() => members.id, { onDelete: 'set null' }),
    publishedAt: ts('published_at').notNull().defaultNow(),
  },
  (t) => [unique('flow_versions_flow_version_uq').on(t.flowId, t.version)],
);

export const flowExecutions = pgTable(
  'flow_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flows.id, { onDelete: 'cascade' }),
    flowVersionId: uuid('flow_version_id')
      .notNull()
      .references(() => flowVersions.id, { onDelete: 'restrict' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    triggeredBy: text('triggered_by').notNull(),
    triggeredByMemberId: uuid('triggered_by_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default('running'),
    currentNodeId: text('current_node_id'),
    variables: jsonb('variables').$type<Record<string, unknown>>().notNull().default({}),
    nextStepAt: ts('next_step_at'),
    lastError: text('last_error'),
    startedAt: ts('started_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
    completedAt: ts('completed_at'),
  },
  (t) => [
    index('idx_flow_executions_status_next')
      .on(t.status, t.nextStepAt)
      .where(sql`${t.status} = 'waiting' and ${t.nextStepAt} is not null`),
    index('idx_flow_executions_workspace_status').on(t.workspaceId, t.status),
    index('idx_flow_executions_conversation')
      .on(t.conversationId)
      .where(sql`${t.conversationId} is not null`),
    check('flow_executions_triggered_by_chk', sql`${t.triggeredBy} in ('manual','automatic','api')`),
    check(
      'flow_executions_status_chk',
      sql`${t.status} in ('running','waiting','completed','failed','cancelled')`,
    ),
  ],
);

export const flowLogs = pgTable(
  'flow_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => flowExecutions.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    nodeType: text('node_type').notNull(),
    level: text('level').notNull(),
    message: text('message'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_flow_logs_execution_created').on(t.executionId, t.createdAt),
    check('flow_logs_level_chk', sql`${t.level} in ('debug','info','warn','error')`),
  ],
);

export const flowSubmissions = pgTable(
  'flow_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    metaFlowId: text('meta_flow_id').notNull(),
    externalId: text('external_id'),
    response: jsonb('response').$type<Record<string, unknown>>().notNull(),
    processedAt: ts('processed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_flow_submissions_workspace_created').on(t.workspaceId, t.createdAt.desc())],
);
