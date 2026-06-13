/**
 * Contrato tipado (Zod) entre o Node e o microsserviço Python `agent-runtime`.
 *
 * Fonte da verdade do request/response do endpoint `POST /run` (e `/resume`,
 * `/cancel`, `/health`). Espelha o schema FastAPI/Pydantic do runtime
 * (`AGENTS_LANGGRAPH.md` §2, §3.1, §10). Enquanto o `/run` do runtime é um
 * placeholder (F2-S02) e até o grafo real (F2-S05), este Zod é o contrato
 * canônico — validado em ambos os lados via contract test (§21).
 *
 * Convenção de wire: snake_case (Python/Pydantic). O cliente expõe a mesma
 * forma para não introduzir uma camada de tradução frágil; o boundary é
 * validado por Zod tanto no envio quanto na recepção.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Policy snapshot (resolvido pelo Node, aplicado pelo runtime — §3.1, §8)
// ---------------------------------------------------------------------------

/**
 * Snapshot de policy resolvido pelo Node antes da chamada e reaplicado
 * defensivamente pelo runtime. `remaining_monthly_budget_usd = null` significa
 * "sem cap". Load-bearing: quebrar = quebrar execuções salvas no checkpoint.
 */
export const PolicySnapshotSchema = z.object({
  allowed_models: z.array(z.string().min(1)),
  allow_streaming: z.boolean(),
  allow_interrupts: z.boolean(),
  allow_parallel_tools: z.boolean(),
  allow_vision: z.boolean(),
  allow_transcription: z.boolean(),
  max_iterations: z.number().int().positive(),
  max_tokens_per_call: z.number().int().positive(),
  max_tools_per_agent: z.number().int().nonnegative(),
  allowed_tool_categories: z.array(z.string().min(1)),
  remaining_monthly_budget_usd: z.number().nonnegative().nullable(),
});

export type PolicySnapshot = z.infer<typeof PolicySnapshotSchema>;

// ---------------------------------------------------------------------------
// Mensagens (espelha ChatMessage do Pydantic — §3.1)
// ---------------------------------------------------------------------------

export const ChatRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

/**
 * Histórico de mensagens passado ao runtime. `tool_calls` é deixado como
 * `unknown[]` (formato OpenAI/OpenRouter, não load-bearing para o cliente Node).
 */
export const ChatMessageSchema = z.object({
  role: ChatRoleSchema,
  content: z.string().nullable().optional(),
  tool_calls: z.array(z.unknown()).nullable().optional(),
  tool_call_id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// ---------------------------------------------------------------------------
// Tool descriptor (filtrado pela policy no Node, passado ao runtime — §8.1)
// ---------------------------------------------------------------------------

/**
 * Descritor de tool que o Node resolve (categoria + config) e envia ao runtime.
 * `config` é arbitrário (column-level ACL etc. — §6.5), então fica `unknown`.
 */
export const ToolDescriptorSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  category: z.string().min(1),
  config: z.record(z.unknown()).optional(),
});

export type ToolDescriptor = z.infer<typeof ToolDescriptorSchema>;

// ---------------------------------------------------------------------------
// Request /run (§8.1, §10)
// ---------------------------------------------------------------------------

/**
 * Request do `POST /run`. snake_case no wire (Pydantic). `messages` é o
 * histórico já carregado; `user_input` é o turno novo.
 */
export const AgentRunRequestSchema = z.object({
  workspace_id: z.string().min(1),
  agent_id: z.string().min(1),
  conversation_id: z.string().min(1).nullable().optional(),
  contact_id: z.string().min(1).nullable().optional(),
  /** Override do thread_id do checkpoint (default: derivado da conversa). */
  thread_id: z.string().min(1).optional(),
  user_input: z.string(),
  messages: z.array(ChatMessageSchema).default([]),
  policy_snapshot: PolicySnapshotSchema,
  tools: z.array(ToolDescriptorSchema).default([]),
  /** Tools de negócio simulam (não escrevem) quando true — §15. */
  is_playground: z.boolean().default(false),
  /** Metadados opacos repassados ao runtime (ex.: `{ kind: 'follow_up' }`). */
  metadata: z.record(z.unknown()).optional(),
});

export type AgentRunRequest = z.input<typeof AgentRunRequestSchema>;
/** Request já normalizado (defaults aplicados) — o que vai no wire. */
export type AgentRunRequestParsed = z.output<typeof AgentRunRequestSchema>;

// ---------------------------------------------------------------------------
// Usage (§10.2, §11)
// ---------------------------------------------------------------------------

export const UsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  reasoning_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional(),
  total_cost_usd: z.number().nonnegative(),
});

export type Usage = z.infer<typeof UsageSchema>;

// ---------------------------------------------------------------------------
// Eventos de stream (§10.2) — discriminated union por `type`
// ---------------------------------------------------------------------------

export const AgentStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('token'), content: z.string() }),
  z.object({
    type: z.literal('tool_call_started'),
    tool_key: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal('tool_call_completed'),
    tool_key: z.string(),
    result: z.unknown(),
    duration_ms: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('interrupt'),
    reason: z.string(),
    tool_key: z.string(),
    args: z.unknown(),
  }),
  z.object({ type: z.literal('iteration_exceeded') }),
  z.object({ type: z.literal('budget_exceeded') }),
  z.object({ type: z.literal('model_blocked'), reason: z.string() }),
  z.object({
    type: z.literal('final'),
    reply: z.string(),
    usage: UsageSchema,
    openrouter_generation_id: z.string().nullable(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);

export type AgentStreamEvent = z.infer<typeof AgentStreamEventSchema>;

/** Narrowing helpers — evitam `as` no consumidor (worker F2-S11). */
export type AgentFinalEvent = Extract<AgentStreamEvent, { type: 'final' }>;
export type AgentErrorEvent = Extract<AgentStreamEvent, { type: 'error' }>;

// ---------------------------------------------------------------------------
// Health (§2: GET /healthz)
// ---------------------------------------------------------------------------

export const HealthResponseSchema = z.object({
  status: z.string(),
  service: z.string().optional(),
  version: z.string().optional(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ---------------------------------------------------------------------------
// Evaluation / LLM-judge (F29) — POST /internal/evaluate
// ---------------------------------------------------------------------------

/** Vocabulario controlado de categoria de objecao (espelha o CHECK de `objections`). */
export const ObjectionCategorySchema = z.enum([
  'price',
  'timing',
  'trust',
  'competitor',
  'feature_gap',
  'authority',
  'other',
]);
export type ObjectionCategory = z.infer<typeof ObjectionCategorySchema>;

export const CsatLabelSchema = z.enum(['promoter', 'neutral', 'detractor']);
export type CsatLabel = z.infer<typeof CsatLabelSchema>;

export const HandledBySchema = z.enum(['ai', 'human', 'mixed']);
export type HandledBy = z.infer<typeof HandledBySchema>;

/** Uma objecao classificada pelo judge. */
export const JudgeObjectionSchema = z.object({
  category: ObjectionCategorySchema,
  label: z.string().min(1),
  excerpt: z.string().nullable().optional(),
  resolved: z.boolean().default(false),
});
export type JudgeObjection = z.infer<typeof JudgeObjectionSchema>;

/** Resultado estruturado e validado do LLM-judge (espelha o Pydantic `JudgeResult`). */
export const JudgeResultSchema = z.object({
  quality_score: z.number().int().min(0).max(100),
  quality_rationale: z.string().nullable().optional(),
  sentiment_score: z.number().int().min(-100).max(100).nullable().optional(),
  csat_label: CsatLabelSchema.nullable().optional(),
  handled_by: HandledBySchema,
  objections: z.array(JudgeObjectionSchema).default([]),
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

/** Request do `POST /internal/evaluate`. snake_case no wire (Pydantic). */
export const EvaluateRequestSchema = z.object({
  workspace_id: z.string().min(1),
  conversation_id: z.string().min(1),
});
export type EvaluateRequest = z.input<typeof EvaluateRequestSchema>;

/** Resposta do `POST /internal/evaluate`: JudgeResult + modelo/custo do judge. */
export const EvaluateResponseSchema = z.object({
  result: JudgeResultSchema,
  judge_model: z.string().min(1),
  judge_cost_usd: z.number().nonnegative(),
});
export type EvaluateResponse = z.infer<typeof EvaluateResponseSchema>;
