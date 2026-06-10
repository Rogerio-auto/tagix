/**
 * Agents domain — core (DATA_MODEL §7.1, §7.8, §7.10 / AGENTS_LANGGRAPH §1, §8).
 *
 * - `agents` (workspace-scoped → RLS): configuração de um agente IA. `model` é o
 *   slug OpenRouter; o backend valida contra `workspace_agent_policies.allowed_models`.
 * - `agent_metrics` (workspace-scoped → RLS): agregação diária/semanal/mensal por agente.
 * - `workspace_agent_policies` (workspace-scoped → RLS): limites de IA por workspace,
 *   definidos por super-admin. Todo request ao agent-runtime carrega um snapshot disso
 *   (PolicySnapshot). PK = workspace_id (1:1 com workspace).
 *
 * `template_id` referencia `agent_templates` (tabela global, ver agent_templates.ts).
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
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
import { agentTemplates, members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id').references(() => agentTemplates.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    systemPrompt: text('system_prompt').notNull(),
    /** Slug OpenRouter (ex: 'openai/gpt-4o-mini'); validado contra a policy do workspace. */
    model: text('model').notNull().default('openai/gpt-4o-mini'),
    modelParams: jsonb('model_params').$type<Record<string, unknown>>().notNull().default({}),
    /** vision/transcription apontam para modelos OpenAI direto (OpenRouter não roteia). */
    visionModel: text('vision_model').default('gpt-4o'),
    transcriptionModel: text('transcription_model').default('whisper-1'),
    status: text('status').notNull().default('active'),
    aggregationEnabled: boolean('aggregation_enabled').notNull().default(true),
    aggregationWindowSec: integer('aggregation_window_sec').notNull().default(20),
    maxBatchMessages: integer('max_batch_messages').notNull().default(20),
    /** null = sem auto follow-up. */
    replyIfIdleSec: integer('reply_if_idle_sec'),
    allowHandoff: boolean('allow_handoff').notNull().default(true),
    ignoreGroupMessages: boolean('ignore_group_messages').notNull().default(true),
    /** vazio = todos os canais. */
    enabledChannelIds: uuid('enabled_channel_ids').array().notNull().default(sql`'{}'`),
    apiTokenHash: text('api_token_hash'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_agents_workspace_status').on(t.workspaceId, t.status),
    index('idx_agents_template').on(t.templateId).where(sql`${t.templateId} is not null`),
    check('agents_status_chk', sql`${t.status} in ('active','inactive','archived')`),
  ],
);

export const agentMetrics = pgTable(
  'agent_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    period: text('period').notNull(),
    periodStart: date('period_start').notNull(),
    totalConversations: integer('total_conversations').notNull().default(0),
    totalMessages: integer('total_messages').notNull().default(0),
    totalTokens: bigint('total_tokens', { mode: 'number' }).notNull().default(0),
    totalCostUsd: numeric('total_cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    avgLatencyMs: integer('avg_latency_ms').default(0),
    handoffCount: integer('handoff_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
  },
  (t) => [
    unique('agent_metrics_agent_period_uq').on(t.agentId, t.period, t.periodStart),
    index('idx_agent_metrics_workspace_period').on(
      t.workspaceId,
      t.period,
      t.periodStart.desc(),
    ),
    check('agent_metrics_period_chk', sql`${t.period} in ('day','week','month')`),
  ],
);

export const workspaceAgentPolicies = pgTable('workspace_agent_policies', {
  /** PK = workspace_id (1:1). */
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  /** Slugs OpenRouter permitidos. Vazio = herda allow-list do plano. */
  allowedModels: text('allowed_models').array().notNull().default(sql`'{}'`),
  /** Modelo default ao criar agent novo. */
  defaultChatModel: text('default_chat_model'),
  // Features LangGraph.
  allowStreaming: boolean('allow_streaming').notNull().default(true),
  allowInterrupts: boolean('allow_interrupts').notNull().default(false),
  allowParallelTools: boolean('allow_parallel_tools').notNull().default(true),
  allowVision: boolean('allow_vision').notNull().default(false),
  allowTranscription: boolean('allow_transcription').notNull().default(false),
  allowPersistentCheckpoints: boolean('allow_persistent_checkpoints').notNull().default(true),
  /** Agente pode registrar conversion_events; OFF por default (envolve $$). */
  allowAgentConversions: boolean('allow_agent_conversions').notNull().default(false),
  /** Se allow=true e require_approval=true → interrupt LangGraph pede confirmação humana. */
  agentConversionRequireApproval: boolean('agent_conversion_require_approval')
    .notNull()
    .default(true),
  // Limites operacionais.
  maxIterations: integer('max_iterations').notNull().default(5),
  maxToolsPerAgent: integer('max_tools_per_agent').notNull().default(20),
  maxTokensPerCall: integer('max_tokens_per_call').notNull().default(8000),
  /** NULL = sem cap. */
  maxMonthlyCostUsd: numeric('max_monthly_cost_usd', { precision: 10, scale: 2 }),
  maxDailyInvocations: integer('max_daily_invocations'),
  /** Subset de {database,http,workflow,calendar,knowledge}. */
  allowedToolCategories: text('allowed_tool_categories')
    .array()
    .notNull()
    .default(sql`ARRAY['database','workflow','calendar','knowledge']::text[]`),
  // Audit.
  updatedBy: uuid('updated_by').references(() => members.id, { onDelete: 'set null' }),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
