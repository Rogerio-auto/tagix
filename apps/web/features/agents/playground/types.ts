/**
 * Tipos de view do Playground (F2-S19).
 *
 * O `SseEvent` espelha a discriminated union do `agent-runtime`
 * (`@hm/agents-client`.`AgentStreamEvent`, AGENTS_LANGGRAPH §10.2). Não
 * importamos o pacote Node `@hm/agents-client` no bundle do browser — duplicamos
 * a forma do wire aqui (validada no boundary do servidor pela API) e fazemos um
 * parse defensivo dos frames SSE (`parseSseEvent`).
 */

/** Usage do evento `final` (custo + tokens). */
export interface SseUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly reasoning_tokens?: number;
  readonly total_tokens?: number;
  readonly total_cost_usd: number;
}

/** Evento SSE — espelha `AgentStreamEvent` do runtime. */
export type SseEvent =
  | { readonly type: 'token'; readonly content: string }
  | { readonly type: 'tool_call_started'; readonly tool_key: string; readonly args: unknown }
  | {
      readonly type: 'tool_call_completed';
      readonly tool_key: string;
      readonly result: unknown;
      readonly duration_ms: number;
    }
  | { readonly type: 'interrupt'; readonly reason: string; readonly tool_key: string; readonly args: unknown }
  | { readonly type: 'iteration_exceeded' }
  | { readonly type: 'budget_exceeded' }
  | { readonly type: 'model_blocked'; readonly reason: string }
  | {
      readonly type: 'final';
      readonly reply: string;
      readonly usage: SseUsage;
      readonly openrouter_generation_id: string | null;
    }
  | { readonly type: 'error'; readonly message: string };

/** Chip de uma chamada de tool no transcript (started → completed). */
export interface ToolCallView {
  readonly id: string;
  readonly toolKey: string;
  readonly status: 'running' | 'done';
  readonly durationMs?: number;
}

/** Bolha de uma das partes da conversa (usuário ou assistente). */
export interface TranscriptTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  /** Texto acumulado (tokens) ou final. */
  text: string;
  /** Tool calls observadas durante o turno do assistente. */
  toolCalls: ToolCallView[];
  /** Usage do `final` (só assistente, quando concluído). */
  usage?: SseUsage;
  /** `true` enquanto tokens ainda chegam (mostra cursor). */
  streaming: boolean;
}

/** Estado terminal de erro do turno (render 3-partes com ref copiável). */
export interface PlaygroundError {
  /** O QUÊ. */
  readonly title: string;
  /** POR QUÊ. */
  readonly reason?: string;
  /** Ref copiável (extraída do frame quando presente). */
  readonly reference?: string;
}

/** Type guard leve: valida a forma mínima de um `SseEvent` parseado de JSON. */
export function parseSseEvent(raw: unknown): SseEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const type = obj['type'];
  switch (type) {
    case 'token':
      return typeof obj['content'] === 'string' ? { type, content: obj['content'] } : null;
    case 'tool_call_started':
      return typeof obj['tool_key'] === 'string'
        ? { type, tool_key: obj['tool_key'], args: obj['args'] }
        : null;
    case 'tool_call_completed':
      return typeof obj['tool_key'] === 'string' && typeof obj['duration_ms'] === 'number'
        ? { type, tool_key: obj['tool_key'], result: obj['result'], duration_ms: obj['duration_ms'] }
        : null;
    case 'interrupt':
      return typeof obj['tool_key'] === 'string' && typeof obj['reason'] === 'string'
        ? { type, tool_key: obj['tool_key'], reason: obj['reason'], args: obj['args'] }
        : null;
    case 'iteration_exceeded':
    case 'budget_exceeded':
      return { type };
    case 'model_blocked':
      return typeof obj['reason'] === 'string' ? { type, reason: obj['reason'] } : null;
    case 'final': {
      const usage = obj['usage'];
      if (typeof obj['reply'] !== 'string' || typeof usage !== 'object' || usage === null) return null;
      const u = usage as Record<string, unknown>;
      return {
        type,
        reply: obj['reply'],
        usage: {
          prompt_tokens: Number(u['prompt_tokens'] ?? 0),
          completion_tokens: Number(u['completion_tokens'] ?? 0),
          reasoning_tokens: typeof u['reasoning_tokens'] === 'number' ? u['reasoning_tokens'] : undefined,
          total_tokens: typeof u['total_tokens'] === 'number' ? u['total_tokens'] : undefined,
          total_cost_usd: Number(u['total_cost_usd'] ?? 0),
        },
        openrouter_generation_id:
          typeof obj['openrouter_generation_id'] === 'string' ? obj['openrouter_generation_id'] : null,
      };
    }
    case 'error':
      return typeof obj['message'] === 'string' ? { type, message: obj['message'] } : null;
    default:
      return null;
  }
}
