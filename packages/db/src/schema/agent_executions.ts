/**
 * Agent executions (DATA_MODEL §7.7 / AGENTS_LANGGRAPH §3.4, §4.1).
 *
 * Registro de cada execução do grafo LangGraph por agente. `thread_id` é o thread
 * do LangGraph; `state` guarda o snapshot do StateGraph (permite retomar interrupts).
 * Workspace-scoped → RLS. Os checkpoints internos do LangGraph (`langgraph_*`) são
 * tabelas auxiliares criadas pela própria lib (AsyncPostgresSaver.setup()) — não
 * modeladas aqui.
 *
 * `execution_id` em `tool_logs`/`llm_usage_logs` correlaciona com esta tabela (não FK,
 * pois execuções podem ser purgadas independentemente dos logs).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { agents, conversations, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const agentExecutions = pgTable(
  'agent_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    /** LangGraph thread_id. */
    threadId: text('thread_id').notNull(),
    status: text('status').notNull().default('running'),
    currentNode: text('current_node'),
    /** Snapshot do StateGraph state. */
    state: jsonb('state').$type<Record<string, unknown>>().notNull(),
    totalTokens: integer('total_tokens').default(0),
    totalCostUsd: numeric('total_cost_usd', { precision: 10, scale: 6 }).default('0'),
    startedAt: ts('started_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
    completedAt: ts('completed_at'),
    error: text('error'),
  },
  (t) => [
    index('idx_agent_executions_thread').on(t.threadId),
    index('idx_agent_executions_conversation')
      .on(t.conversationId)
      .where(sql`${t.conversationId} is not null`),
    index('idx_agent_executions_agent_started').on(t.agentId, t.startedAt.desc()),
    check(
      'agent_executions_status_chk',
      sql`${t.status} in ('running','interrupted','completed','failed')`,
    ),
  ],
);
