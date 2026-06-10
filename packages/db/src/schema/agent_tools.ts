/**
 * Tools domain (DATA_MODEL §7.4–7.6 / AGENTS_LANGGRAPH §6, §7).
 *
 * - `tools` (catálogo): tools globais da plataforma (`workspace_id IS NULL`,
 *   `is_global = true`) + tools por workspace (custom, fase 2). NÃO recebe RLS de
 *   tenant — as linhas globais precisam ser legíveis por todos; filtro por workspace
 *   feito no app. Fora de RLS_TABLES.
 * - `agent_tools` (junção agent↔tool, workspace-scoped via `agents` → RLS): habilita/
 *   desabilita uma tool por agente e carrega `overrides` (deep-merge sobre
 *   `tools.handler_config` no boot do runtime). PK composta (agent_id, tool_id). Como
 *   não tem `workspace_id` próprio, a RLS é por subquery na tabela `agents`.
 * - `tool_logs` (workspace-scoped → RLS): trilha de execução de tools (substitui
 *   `agent_tool_logs` do v1). INSERT vem do runtime Python via asyncpg.
 *
 * `tools.handler_config` (jsonb) carrega column-level ACL p/ tools 'database':
 *   { table, action, allowed_columns:{read[],write[]}, restricted_columns[],
 *     required_columns[], requires_human_approval, timeout_ms }
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { agents, contacts, conversations, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const tools = pgTable(
  'tools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** NULL = tool global da plataforma; setado = tool custom do workspace. */
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    /** OpenAI function schema. */
    schema: jsonb('schema').$type<Record<string, unknown>>().notNull(),
    /** table, action, columns ACL, etc. — ver doc do header. */
    handlerConfig: jsonb('handler_config').$type<Record<string, unknown>>().notNull().default({}),
    isGlobal: boolean('is_global').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    unique('tools_workspace_key_uq').on(t.workspaceId, t.key),
    index('idx_tools_global').on(t.isGlobal).where(sql`${t.isGlobal} = true`),
    check(
      'tools_category_chk',
      sql`${t.category} in ('database','http','workflow','calendar','knowledge')`,
    ),
  ],
);

export const agentTools = pgTable(
  'agent_tools',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    toolId: uuid('tool_id')
      .notNull()
      .references(() => tools.id, { onDelete: 'cascade' }),
    isEnabled: boolean('is_enabled').notNull().default(true),
    /** Overrides parciais do `handler_config` base (deep-merge no boot do runtime). */
    overrides: jsonb('overrides').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.toolId] })],
);

export const toolLogs = pgTable(
  'tool_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    toolId: uuid('tool_id')
      .notNull()
      .references(() => tools.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    /** Correlação com `agent_executions` (não FK — execução pode ser purgada). */
    executionId: uuid('execution_id'),
    /** 'select','update','insert','http','workflow'. */
    action: text('action').notNull(),
    tableName: text('table_name'),
    columnsAccessed: text('columns_accessed').array(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    durationMs: integer('duration_ms'),
    executedAt: ts('executed_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_tool_logs_workspace_executed').on(t.workspaceId, t.executedAt.desc()),
    index('idx_tool_logs_agent')
      .on(t.agentId, t.executedAt.desc())
      .where(sql`${t.agentId} is not null`),
    index('idx_tool_logs_conversation')
      .on(t.conversationId)
      .where(sql`${t.conversationId} is not null`),
  ],
);
