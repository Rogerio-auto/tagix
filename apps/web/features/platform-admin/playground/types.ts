/**
 * Tipos de view do Agent Playground de plataforma (F26-S10).
 * Espelha o wire SSE do agent-runtime (parse defensivo). Sandbox: zero side-effect.
 */
export interface SbUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens?: number;
  readonly total_cost_usd: number;
}

export type SbEvent =
  | { readonly type: 'token'; readonly content: string }
  | { readonly type: 'tool_call_started'; readonly tool_key: string }
  | { readonly type: 'tool_call_completed'; readonly tool_key: string; readonly duration_ms: number }
  | { readonly type: 'model_blocked'; readonly reason: string }
  | { readonly type: 'budget_exceeded' }
  | { readonly type: 'iteration_exceeded' }
  | {
      readonly type: 'final';
      readonly reply: string;
      readonly usage: SbUsage;
      readonly openrouter_generation_id: string | null;
    }
  | { readonly type: 'error'; readonly message: string };

export interface TraceEntry {
  readonly id: string;
  readonly toolKey: string;
  status: 'running' | 'done';
  durationMs?: number;
}

export function parseSbEvent(raw: unknown): SbEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const type = o['type'];
  switch (type) {
    case 'token':
      return typeof o['content'] === 'string' ? { type, content: o['content'] } : null;
    case 'tool_call_started':
      return typeof o['tool_key'] === 'string' ? { type, tool_key: o['tool_key'] } : null;
    case 'tool_call_completed':
      return typeof o['tool_key'] === 'string' && typeof o['duration_ms'] === 'number'
        ? { type, tool_key: o['tool_key'], duration_ms: o['duration_ms'] }
        : null;
    case 'model_blocked':
      return typeof o['reason'] === 'string' ? { type, reason: o['reason'] } : null;
    case 'budget_exceeded':
    case 'iteration_exceeded':
      return { type };
    case 'final': {
      const u = o['usage'];
      if (typeof o['reply'] !== 'string' || typeof u !== 'object' || u === null) return null;
      const usage = u as Record<string, unknown>;
      return {
        type,
        reply: o['reply'],
        usage: {
          prompt_tokens: Number(usage['prompt_tokens'] ?? 0),
          completion_tokens: Number(usage['completion_tokens'] ?? 0),
          total_tokens: typeof usage['total_tokens'] === 'number' ? usage['total_tokens'] : undefined,
          total_cost_usd: Number(usage['total_cost_usd'] ?? 0),
        },
        openrouter_generation_id:
          typeof o['openrouter_generation_id'] === 'string' ? o['openrouter_generation_id'] : null,
      };
    }
    case 'error':
      return typeof o['message'] === 'string' ? { type, message: o['message'] } : null;
    default:
      return null;
  }
}
