/**
 * Seed idempotente do catálogo GLOBAL `llm_models_whitelist` (DATA_MODEL §7.11 /
 * AGENTS_LANGGRAPH §5.2).
 *
 * Snapshot dos top modelos OpenRouter de uso real: slug, label, capacidades e
 * pricing (USD por 1M tokens, unidade que o schema `pricing_*_per_1m` espera e
 * que alimenta F2-S13 cost metrics + F2-S09 cost hard-cap).
 *
 * Idempotência: upsert por `slug` (UNIQUE). `onConflictDoUpdate` reaplica o
 * snapshot — re-rodar o seed sincroniza pricing/capacidades sem duplicar linhas.
 * Pricing é `numeric` → valores como strings (USD por 1M tokens).
 *
 * A coluna `synced_at` fica nula de propósito: estes registros vêm do seed, não
 * do sync ao vivo OpenRouter (F2.5-S02), que carimba `synced_at` ao atualizar.
 */
import { sql } from 'drizzle-orm';
import type { DB } from '../client';
import { llmModelsWhitelist } from '../schema';

type LlmModelSeed = typeof llmModelsWhitelist.$inferInsert;

/**
 * Pricing OpenRouter (USD por 1M tokens) capturado no momento do seed.
 * F2.5-S02 mantém atualizado depois via `GET /api/v1/models`.
 */
const LLM_MODELS: readonly LlmModelSeed[] = [
  // ── OpenAI ──────────────────────────────────────────────────────────────
  {
    slug: 'openai/gpt-4o-mini',
    displayName: 'GPT-4o mini',
    upstreamProvider: 'openai',
    contextLength: 128_000,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    pricingPromptPer1m: '0.150000',
    pricingCompletionPer1m: '0.600000',
    isActive: true,
    defaultPlanKeys: ['free', 'starter', 'pro', 'business'],
    notes: 'Default barato/rápido. Modelo padrão dos templates de agente.',
  },
  {
    slug: 'openai/gpt-4o',
    displayName: 'GPT-4o',
    upstreamProvider: 'openai',
    contextLength: 128_000,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    pricingPromptPer1m: '2.500000',
    pricingCompletionPer1m: '10.000000',
    isActive: true,
    defaultPlanKeys: ['pro', 'business'],
    notes: 'Capability alta, multimodal.',
  },
  {
    slug: 'openai/gpt-4.1',
    displayName: 'GPT-4.1',
    upstreamProvider: 'openai',
    contextLength: 1_047_576,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    pricingPromptPer1m: '2.000000',
    pricingCompletionPer1m: '8.000000',
    isActive: true,
    defaultPlanKeys: ['pro', 'business'],
    notes: 'Contexto de 1M tokens, forte em coding/instruções.',
  },
  {
    slug: 'openai/gpt-4.1-mini',
    displayName: 'GPT-4.1 mini',
    upstreamProvider: 'openai',
    contextLength: 1_047_576,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    pricingPromptPer1m: '0.400000',
    pricingCompletionPer1m: '1.600000',
    isActive: true,
    defaultPlanKeys: ['starter', 'pro', 'business'],
    notes: 'Equilíbrio custo/capacidade com contexto de 1M tokens.',
  },
  {
    slug: 'openai/o4-mini',
    displayName: 'o4-mini',
    upstreamProvider: 'openai',
    contextLength: 200_000,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    pricingPromptPer1m: '1.100000',
    pricingCompletionPer1m: '4.400000',
    isActive: true,
    defaultPlanKeys: ['pro', 'business'],
    notes: 'Reasoning model econômico (reasoning_tokens contabilizados).',
  },
  // ── Anthropic ───────────────────────────────────────────────────────────
  {
    slug: 'anthropic/claude-3.5-sonnet',
    displayName: 'Claude 3.5 Sonnet',
    upstreamProvider: 'anthropic',
    contextLength: 200_000,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    pricingPromptPer1m: '3.000000',
    pricingCompletionPer1m: '15.000000',
    isActive: true,
    defaultPlanKeys: ['pro', 'business'],
    notes: 'Alternativa premium. Forte em escrita e tool-use.',
  },
  {
    slug: 'anthropic/claude-3.5-haiku',
    displayName: 'Claude 3.5 Haiku',
    upstreamProvider: 'anthropic',
    contextLength: 200_000,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    pricingPromptPer1m: '0.800000',
    pricingCompletionPer1m: '4.000000',
    isActive: true,
    defaultPlanKeys: ['starter', 'pro', 'business'],
    notes: 'Econômico e rápido na linha Anthropic.',
  },
  {
    slug: 'anthropic/claude-sonnet-4',
    displayName: 'Claude Sonnet 4',
    upstreamProvider: 'anthropic',
    contextLength: 200_000,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    pricingPromptPer1m: '3.000000',
    pricingCompletionPer1m: '15.000000',
    isActive: true,
    defaultPlanKeys: ['business'],
    notes: 'Geração 4: raciocínio e agentic tool-use de ponta.',
  },
  // ── Google ──────────────────────────────────────────────────────────────
  {
    slug: 'google/gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    upstreamProvider: 'google',
    contextLength: 1_048_576,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    pricingPromptPer1m: '1.250000',
    pricingCompletionPer1m: '10.000000',
    isActive: true,
    defaultPlanKeys: ['pro', 'business'],
    notes: 'Contexto longo (1M+), multimodal.',
  },
  {
    slug: 'google/gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    upstreamProvider: 'google',
    contextLength: 1_048_576,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    pricingPromptPer1m: '0.300000',
    pricingCompletionPer1m: '2.500000',
    isActive: true,
    defaultPlanKeys: ['starter', 'pro', 'business'],
    notes: 'Rápido e barato com contexto longo e visão.',
  },
  {
    slug: 'google/gemini-2.0-flash-001',
    displayName: 'Gemini 2.0 Flash',
    upstreamProvider: 'google',
    contextLength: 1_048_576,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    pricingPromptPer1m: '0.100000',
    pricingCompletionPer1m: '0.400000',
    isActive: true,
    defaultPlanKeys: ['free', 'starter', 'pro', 'business'],
    notes: 'Opção multimodal de menor custo.',
  },
  // ── Meta (open source via OpenRouter) ─────────────────────────────────────
  {
    slug: 'meta-llama/llama-3.3-70b-instruct',
    displayName: 'Llama 3.3 70B Instruct',
    upstreamProvider: 'meta',
    contextLength: 131_072,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    pricingPromptPer1m: '0.120000',
    pricingCompletionPer1m: '0.300000',
    isActive: true,
    defaultPlanKeys: ['starter', 'pro', 'business'],
    notes: 'Open source de bom custo-benefício via OpenRouter.',
  },
  {
    slug: 'meta-llama/llama-3.1-8b-instruct',
    displayName: 'Llama 3.1 8B Instruct',
    upstreamProvider: 'meta',
    contextLength: 131_072,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    pricingPromptPer1m: '0.020000',
    pricingCompletionPer1m: '0.030000',
    isActive: true,
    defaultPlanKeys: ['free', 'starter', 'pro', 'business'],
    notes: 'Ultra-barato para tarefas simples / alto volume.',
  },
  // ── Mistral ───────────────────────────────────────────────────────────────
  {
    slug: 'mistralai/mistral-large',
    displayName: 'Mistral Large',
    upstreamProvider: 'mistral',
    contextLength: 131_072,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    pricingPromptPer1m: '2.000000',
    pricingCompletionPer1m: '6.000000',
    isActive: true,
    defaultPlanKeys: ['pro', 'business'],
    notes: 'Flagship Mistral, forte em tool-use.',
  },
  {
    slug: 'mistralai/mistral-small-3.1-24b-instruct',
    displayName: 'Mistral Small 3.1 24B',
    upstreamProvider: 'mistral',
    contextLength: 131_072,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    pricingPromptPer1m: '0.100000',
    pricingCompletionPer1m: '0.300000',
    isActive: true,
    defaultPlanKeys: ['starter', 'pro', 'business'],
    notes: 'Compacto, multimodal e barato.',
  },
  // ── DeepSeek ──────────────────────────────────────────────────────────────
  {
    slug: 'deepseek/deepseek-chat-v3',
    displayName: 'DeepSeek V3',
    upstreamProvider: 'deepseek',
    contextLength: 163_840,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    pricingPromptPer1m: '0.270000',
    pricingCompletionPer1m: '1.100000',
    isActive: true,
    defaultPlanKeys: ['starter', 'pro', 'business'],
    notes: 'Capability alta a custo baixo via OpenRouter.',
  },
];

/**
 * Popula/atualiza o catálogo global de modelos. Idempotente via upsert por `slug`.
 * Não recebe transação própria — usa o handle `db` do orchestrator (`seed.ts`).
 */
export async function seedLlmModels(db: DB): Promise<void> {
  await db
    .insert(llmModelsWhitelist)
    .values(LLM_MODELS as LlmModelSeed[])
    .onConflictDoUpdate({
      target: llmModelsWhitelist.slug,
      set: {
        displayName: sql`excluded.display_name`,
        upstreamProvider: sql`excluded.upstream_provider`,
        contextLength: sql`excluded.context_length`,
        supportsTools: sql`excluded.supports_tools`,
        supportsVision: sql`excluded.supports_vision`,
        supportsStreaming: sql`excluded.supports_streaming`,
        pricingPromptPer1m: sql`excluded.pricing_prompt_per_1m`,
        pricingCompletionPer1m: sql`excluded.pricing_completion_per_1m`,
        isActive: sql`excluded.is_active`,
        defaultPlanKeys: sql`excluded.default_plan_keys`,
        notes: sql`excluded.notes`,
        updatedAt: sql`now()`,
      },
    });

  console.log(`[db] seed llm_models ok — ${LLM_MODELS.length} modelos na whitelist`);
}
