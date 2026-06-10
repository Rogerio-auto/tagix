/**
 * LLM domain (DATA_MODEL §7.9, §7.11 / AGENTS_LANGGRAPH §5, §11).
 *
 * - `llm_usage_logs` (workspace-scoped → RLS): cost tracking detalhado de toda
 *   chamada LLM. Chat sempre via OpenRouter (`router='openrouter'`), com
 *   `openrouter_generation_id` para auditoria do trace real e `upstream_provider`
 *   para o provider físico por trás do roteador. Embeddings/transcription/vision
 *   vão direto à OpenAI (`router='openai_direct'`). Substitui `openai_usage_logs` do v1.
 *
 * - `llm_models_whitelist` (GLOBAL, sem `workspace_id` → fora de RLS): catálogo de
 *   modelos da plataforma, synced da OpenRouter `GET /api/v1/models`. Super-admin
 *   marca quais entram. Legível por todos os workspaces (alimenta o dropdown do wizard).
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
  uuid,
} from 'drizzle-orm/pg-core';
import { agents, conversations, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const llmUsageLogs = pgTable(
  'llm_usage_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    /** Correlação com `agent_executions` (não FK — execução pode ser purgada). */
    executionId: uuid('execution_id'),
    requestType: text('request_type').notNull(),
    /** Chat sempre via openrouter; embeddings/vision/transcription via openai_direct. */
    router: text('router').notNull().default('openrouter'),
    /** ID retornado pela OpenRouter; permite buscar o trace completo no painel deles. */
    openrouterGenerationId: text('openrouter_generation_id'),
    /** Provider físico consumido por trás do OpenRouter (openai|anthropic|google|...). */
    upstreamProvider: text('upstream_provider'),
    /** Slug OpenRouter (ex: 'openai/gpt-4o-mini') ou modelo OpenAI direto. */
    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    /** Modelos o1/o3 etc. */
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 8 }).notNull().default('0'),
    latencyMs: integer('latency_ms'),
    /** stop/length/tool_calls/content_filter. */
    finishReason: text('finish_reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_llm_usage_workspace_created').on(t.workspaceId, t.createdAt.desc()),
    index('idx_llm_usage_model_created').on(t.model, t.createdAt.desc()),
    index('idx_llm_usage_agent_created')
      .on(t.agentId, t.createdAt.desc())
      .where(sql`${t.agentId} is not null`),
    index('idx_llm_usage_openrouter_generation')
      .on(t.openrouterGenerationId)
      .where(sql`${t.openrouterGenerationId} is not null`),
    check(
      'llm_usage_logs_request_type_chk',
      sql`${t.requestType} in ('chat','transcription','vision','embedding','tts','dalle','rerank')`,
    ),
    check('llm_usage_logs_router_chk', sql`${t.router} in ('openrouter','openai_direct')`),
  ],
);

export const llmModelsWhitelist = pgTable(
  'llm_models_whitelist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Slug OpenRouter: 'openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'. */
    slug: text('slug').notNull().unique(),
    displayName: text('display_name').notNull(),
    /** 'openai','anthropic','google','meta','mistral'. */
    upstreamProvider: text('upstream_provider').notNull(),
    contextLength: integer('context_length'),
    supportsTools: boolean('supports_tools').notNull().default(true),
    supportsVision: boolean('supports_vision').notNull().default(false),
    supportsStreaming: boolean('supports_streaming').notNull().default(true),
    /** USD por 1M prompt tokens (snapshot). */
    pricingPromptPer1m: numeric('pricing_prompt_per_1m', { precision: 12, scale: 6 }),
    pricingCompletionPer1m: numeric('pricing_completion_per_1m', { precision: 12, scale: 6 }),
    isActive: boolean('is_active').notNull().default(true),
    /** Planos que herdam esse modelo automaticamente. */
    defaultPlanKeys: text('default_plan_keys').array().notNull().default(sql`'{}'`),
    notes: text('notes'),
    syncedAt: ts('synced_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [index('idx_llm_models_active').on(t.isActive).where(sql`${t.isActive} = true`)],
);
