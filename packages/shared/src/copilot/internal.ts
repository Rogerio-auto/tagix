/**
 * Contrato interno API ↔ agent-runtime do Copiloto (COPILOTO.md §5.4, ADR-003).
 *
 * É a fonte que o runtime Python espelha em pydantic (`app/copilot/types.py`, F73-S04,
 * `extra="forbid"`) e que o cliente Node valida frame a frame (`runCopilot`, F73-S10). Os
 * nomes são snake_case e idênticos dos dois lados: renomear aqui sem renomear lá quebra o
 * teste de contrato do S10, que lê as fixtures JSON exportadas pelo runtime.
 *
 * O que NÃO está aqui, por desenho (ADR-003): identidade. O runtime recebe um `grant`
 * opaco e o devolve em `X-Copilot-Grant`; não há `member_id` nem papel em lugar nenhum.
 */
import { z } from 'zod';
import {
  ActionBlockedEventSchema,
  ActionProposedEventSchema,
  ActionReceiptEventSchema,
  CopilotAnswerBlocksSchema,
  IsoDateTimeSchema,
  ResultIdSchema,
  ToolResultEventSchema,
  UuidSchema,
} from './contracts';
import { COPILOT_MEMORY_PROFILE_KEYS, COPILOT_TOOL_DECISIONS } from './statuses';

/** Chave de ferramenta: `list_deals`, `propose_deal_move`. É o `:key` do callback. */
export const CopilotToolKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'tool_key inválido');

/** Limites duros por turno (R5). O Node também conta `tool_calls` no turno. */
export const COPILOT_POLICY_LIMITS = {
  max_iterations: 8,
  max_tool_calls: 16,
  turn_timeout_s: 60,
  history_max: 12,
  memory_facts_max: 30,
} as const;

/** Ferramenta oferecida ao modelo: só as permitidas ao membro (ADR-003 §3). */
export const CopilotToolDescriptorSchema = z
  .object({
    key: CopilotToolKeySchema,
    /** Para o modelo. Texto do catálogo/registro, nunca de dado de cliente. */
    description: z.string().min(1).max(1024),
    /** JSON Schema dos `args` (gerado do Zod `.strict()` da ferramenta). Forma livre por natureza. */
    parameters: z.record(z.string(), z.unknown()),
  })
  .strict();
export type CopilotToolDescriptor = z.infer<typeof CopilotToolDescriptorSchema>;

export const CopilotPolicySchema = z
  .object({
    model: z.string().min(1).max(120),
    max_iterations: z.number().int().min(1).max(COPILOT_POLICY_LIMITS.max_iterations),
    max_tool_calls: z.number().int().min(0).max(COPILOT_POLICY_LIMITS.max_tool_calls),
    max_tokens_per_call: z.number().int().min(1).max(32_000),
    temperature: z.number().min(0).max(2),
    turn_timeout_s: z.number().int().min(1).max(COPILOT_POLICY_LIMITS.turn_timeout_s),
  })
  .strict();
export type CopilotPolicy = z.infer<typeof CopilotPolicySchema>;

/** `POST {RUNTIME}/copilot/run` (Bearer `AGENT_RUNTIME_TOKEN`). */
export const CopilotRunRequestSchema = z
  .object({
    turn_id: UuidSchema,
    workspace_id: UuidSchema,
    /** Opaco para o runtime: devolvido intacto em `X-Copilot-Grant`. */
    grant: z.string().min(1).max(2048),
    member: z
      .object({
        display_name: z.string().min(1).max(120),
        role_label: z.string().min(1).max(80),
        locale: z.string().min(2).max(35),
        timezone: z.string().min(1).max(64),
      })
      .strict(),
    now_iso: IsoDateTimeSchema,
    page_context_resolved: z
      .object({
        label: z.string().min(1).max(160),
        entity_summary: z.string().max(1000).optional(),
      })
      .strict(),
    history: z
      .array(
        z
          .object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })
          .strict(),
      )
      .max(COPILOT_POLICY_LIMITS.history_max),
    memory: z
      .object({
        profile: z
          .array(
            z
              .object({ key: z.enum(COPILOT_MEMORY_PROFILE_KEYS), content: z.string().min(1).max(500) })
              .strict(),
          )
          .max(COPILOT_MEMORY_PROFILE_KEYS.length),
        facts: z
          .array(
            z
              .object({
                id: UuidSchema,
                content: z.string().min(1).max(500),
                source_label: z.string().min(1).max(200),
                /**
                 * Fato vindo de integração (dado de sistema de terceiro): o runtime aplica
                 * spotlighting nele (F73-S04, F73-S10). Ausente = `false`.
                 */
                untrusted: z.boolean().optional(),
              })
              .strict(),
          )
          .max(COPILOT_POLICY_LIMITS.memory_facts_max),
      })
      .strict(),
    tools: z.array(CopilotToolDescriptorSchema).max(64),
    policy: CopilotPolicySchema,
    user_input: z.string().min(1).max(2000),
  })
  .strict();
export type CopilotRunRequest = z.infer<typeof CopilotRunRequestSchema>;

/** Uso do turno vindo do OpenRouter. `total_cost_usd` é `null` se o provedor não informar. */
export const CopilotRunUsageSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_cost_usd: z.number().nonnegative().nullable(),
  })
  .strict();
export type CopilotRunUsage = z.infer<typeof CopilotRunUsageSchema>;

/** O que o Node manda ao navegador a partir do callback (nunca do texto do modelo; P5). */
export const CopilotToolPublicEventSchema = z.union([
  ToolResultEventSchema,
  z.discriminatedUnion('type', [
    ActionReceiptEventSchema,
    ActionProposedEventSchema,
    ActionBlockedEventSchema,
  ]),
]);
export type CopilotToolPublicEvent = z.infer<typeof CopilotToolPublicEventSchema>;

/** Resposta do callback `POST {API}/internal/copilot/tools/:key`. */
export const CopilotToolEnvelopeSchema = z
  .object({
    ok: z.boolean(),
    decision: z.enum(COPILOT_TOOL_DECISIONS),
    result_id: ResultIdSchema.optional(),
    /**
     * O que o modelo lê: texto ou JSON curto (≤ 24 KB serializado, R5). Dado de contato vem
     * marcado `untrusted` pelo Node; o runtime aplica spotlighting. Forma livre por natureza.
     */
    model_view: z.union([z.string().max(24_576), z.record(z.string(), z.unknown())]),
    public_event: CopilotToolPublicEventSchema.optional(),
  })
  .strict();
export type CopilotToolEnvelope = z.infer<typeof CopilotToolEnvelopeSchema>;

/** Corpo do callback. Sem identidade: ela vem só do grant (ADR-003 §3). */
export const CopilotToolCallBodySchema = z
  .object({
    turn_id: UuidSchema,
    call_id: z.string().min(1).max(128),
    /** Validados depois pelo Zod `.strict()` da ferramenta. */
    args: z.record(z.string(), z.unknown()),
  })
  .strict();
export type CopilotToolCallBody = z.infer<typeof CopilotToolCallBodySchema>;

// ─── Eventos runtime → API (SSE `data: <json>\n\n`) ──────────────────────────

export const RuntimeStatusEventSchema = z
  .object({ type: z.literal('status'), tool_key: CopilotToolKeySchema })
  .strict();

export const RuntimeVerdictDeltaEventSchema = z
  .object({ type: z.literal('verdict_delta'), text: z.string().min(1).max(2000) })
  .strict();

export const RuntimeToolCallCompletedEventSchema = z
  .object({
    type: z.literal('tool_call_completed'),
    tool_key: CopilotToolKeySchema,
    call_id: z.string().min(1).max(128),
    /** A resposta do Node, repassada. O `tool_result` público sai DAQUI. */
    envelope: CopilotToolEnvelopeSchema,
  })
  .strict();

export const RuntimeFinalEventSchema = z
  .object({
    type: z.literal('final'),
    blocks: CopilotAnswerBlocksSchema,
    usage: CopilotRunUsageSchema,
    iterations: z.number().int().nonnegative(),
    /** O modelo respondeu em texto livre e o runtime montou os blocos (métrica da S15). */
    format_fallback: z.boolean().optional(),
  })
  .strict();

export const RuntimeIterationExceededEventSchema = z
  .object({ type: z.literal('iteration_exceeded') })
  .strict();

/**
 * Código do runtime (`timeout`, `model_error`…). Aberto de propósito: a API mapeia para o
 * conjunto fechado público (`COPILOT_ERROR_CODES`), e código desconhecido vira `internal`
 * em vez de derrubar o turno.
 */
export const RuntimeErrorEventSchema = z
  .object({ type: z.literal('error'), code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/) })
  .strict();

export const CopilotRuntimeEventSchema = z.discriminatedUnion('type', [
  RuntimeStatusEventSchema,
  RuntimeVerdictDeltaEventSchema,
  RuntimeToolCallCompletedEventSchema,
  RuntimeFinalEventSchema,
  RuntimeIterationExceededEventSchema,
  RuntimeErrorEventSchema,
]);
export type CopilotRuntimeEvent = z.infer<typeof CopilotRuntimeEventSchema>;
export type CopilotRuntimeEventType = CopilotRuntimeEvent['type'];
export type RuntimeFinalEvent = z.infer<typeof RuntimeFinalEventSchema>;
export type RuntimeToolCallCompletedEvent = z.infer<typeof RuntimeToolCallCompletedEventSchema>;
