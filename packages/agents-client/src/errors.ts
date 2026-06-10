/**
 * Erros tipados do cliente `agent-runtime`.
 *
 * `AgentRuntimeError` normaliza qualquer falha na conversa Node→Python: HTTP
 * não-2xx, timeout/rede, corpo que não bate com o contrato Zod, ou um evento
 * `{ type: 'error' }` emitido pelo grafo. Carrega um `ref` estável para
 * correlação em logs e enforcement de cost-cap a montante (F2-S09).
 */

/** Categoria da falha — permite o consumidor decidir retry/abort sem parsear texto. */
export type AgentRuntimeErrorKind =
  | 'http' // resposta HTTP não-2xx do runtime
  | 'network' // falha de transporte / timeout / abort
  | 'contract' // corpo/evento não bate com o schema Zod
  | 'stream' // SSE malformado / conexão cortada no meio do stream
  | 'runtime'; // evento { type: 'error' } emitido pelo grafo

export interface AgentRuntimeErrorOptions {
  readonly kind: AgentRuntimeErrorKind;
  /** Status HTTP quando aplicável (0 = sem resposta / rede). */
  readonly httpStatus?: number;
  /** `true` se a falha é transitória e a chamada pode ser repetida. */
  readonly retryable?: boolean;
  /** Corpo/diagnóstico bruto (não-serializado) para log. */
  readonly raw?: unknown;
  /** Causa subjacente (erro de fetch, ZodError, etc.). */
  readonly cause?: unknown;
}

export class AgentRuntimeError extends Error {
  readonly kind: AgentRuntimeErrorKind;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly raw?: unknown;
  /** Referência estável p/ correlação em logs (`hm-agent-<kind>-<rand>`). */
  readonly ref: string;

  constructor(message: string, opts: AgentRuntimeErrorOptions) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'AgentRuntimeError';
    this.kind = opts.kind;
    this.httpStatus = opts.httpStatus ?? 0;
    this.retryable = opts.retryable ?? false;
    this.raw = opts.raw;
    this.ref = `hm-agent-${opts.kind}-${randomRef()}`;
    Object.setPrototypeOf(this, AgentRuntimeError.prototype);
  }

  /** Falha HTTP não-2xx; deriva `retryable` de 429/5xx. */
  static http(httpStatus: number, body: unknown): AgentRuntimeError {
    const retryable = httpStatus === 429 || httpStatus >= 500;
    const message = extractMessage(body) ?? `agent-runtime HTTP ${httpStatus}`;
    return new AgentRuntimeError(message, { kind: 'http', httpStatus, retryable, raw: body });
  }

  /** Falha de transporte (rede/timeout/abort) — sempre retryable. */
  static network(reason: string, cause?: unknown): AgentRuntimeError {
    return new AgentRuntimeError(`agent-runtime unreachable: ${reason}`, {
      kind: 'network',
      httpStatus: 0,
      retryable: true,
      cause,
    });
  }

  /** Corpo/evento que não satisfaz o contrato Zod — bug de contrato, não retryable. */
  static contract(message: string, cause?: unknown, raw?: unknown): AgentRuntimeError {
    return new AgentRuntimeError(`agent-runtime contract violation: ${message}`, {
      kind: 'contract',
      retryable: false,
      cause,
      raw,
    });
  }

  /** SSE malformado ou cortado no meio do stream. */
  static stream(message: string, cause?: unknown): AgentRuntimeError {
    return new AgentRuntimeError(`agent-runtime stream error: ${message}`, {
      kind: 'stream',
      retryable: false,
      cause,
    });
  }

  /** Evento `{ type: 'error' }` emitido pelo grafo. */
  static runtime(message: string, raw?: unknown): AgentRuntimeError {
    return new AgentRuntimeError(message, { kind: 'runtime', retryable: false, raw });
  }
}

/** Extrai uma mensagem legível de corpos de erro comuns (FastAPI `{ detail }`, etc.). */
function extractMessage(body: unknown): string | undefined {
  if (typeof body === 'string' && body.length > 0) return body;
  if (typeof body !== 'object' || body === null) return undefined;
  const obj = body as Record<string, unknown>;
  const detail = obj['detail'];
  if (typeof detail === 'string') return detail;
  const msg = obj['message'];
  if (typeof msg === 'string') return msg;
  return undefined;
}

/** Sufixo aleatório curto p/ o `ref` (sem dep externa). */
function randomRef(): string {
  return Math.random().toString(36).slice(2, 10);
}
