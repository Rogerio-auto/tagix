/**
 * Hierarquia de erros Meta (Graph API). Compartilhada WA + IG.
 *
 * O Graph devolve erros no shape `{ error: { message, type, code, ... } }`.
 * `MetaError` normaliza isso e carrega o status HTTP + se vale retry.
 */

/** Subset tipado do corpo de erro do Graph API. */
export interface MetaErrorBody {
  readonly message?: string;
  readonly type?: string;
  readonly code?: number;
  readonly error_subcode?: number;
  readonly fbtrace_id?: string;
}

export class MetaError extends Error {
  /** Status HTTP da resposta Graph (0 = falha de rede / timeout). */
  readonly httpStatus: number;
  /** Código numérico do Graph (`error.code`), se houver. */
  readonly code?: number;
  /** Subcódigo do Graph (`error.error_subcode`), se houver. */
  readonly subcode?: number;
  /** `true` se a falha é transitória e o cliente pode tentar de novo. */
  readonly retryable: boolean;
  /** Corpo bruto, para diagnóstico/log. */
  readonly raw?: unknown;

  constructor(
    message: string,
    opts: {
      httpStatus: number;
      code?: number;
      subcode?: number;
      retryable?: boolean;
      raw?: unknown;
    },
  ) {
    super(message);
    this.name = 'MetaError';
    this.httpStatus = opts.httpStatus;
    this.code = opts.code;
    this.subcode = opts.subcode;
    this.retryable = opts.retryable ?? false;
    this.raw = opts.raw;
    // Mantém a cadeia de protótipo correta ao estender Error em ES2022.
    Object.setPrototypeOf(this, MetaError.prototype);
  }

  /** Constrói a partir de uma resposta Graph já lida como objeto. */
  static fromResponse(httpStatus: number, body: unknown): MetaError {
    const errBody = extractErrorBody(body);
    const retryable = isRetryableStatus(httpStatus) || isRetryableCode(errBody?.code);
    const message = errBody?.message ?? `Graph API error (HTTP ${httpStatus})`;
    return new MetaError(message, {
      httpStatus,
      code: errBody?.code,
      subcode: errBody?.error_subcode,
      retryable,
      raw: body,
    });
  }
}

/** Extrai `body.error` com narrowing seguro (sem `any`). */
function extractErrorBody(body: unknown): MetaErrorBody | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const error = (body as { error: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  return error as MetaErrorBody;
}

/** 429 + 5xx são transitórios. */
export function isRetryableStatus(httpStatus: number): boolean {
  return httpStatus === 0 || httpStatus === 429 || httpStatus >= 500;
}

/** Códigos Graph transitórios conhecidos (rate limit / temporário). */
function isRetryableCode(code: number | undefined): boolean {
  if (code === undefined) return false;
  // 4: app rate limit; 17: user rate limit; 80007: IG rate; 613: calls/hour; 1: desconhecido temporário; 2: serviço temporário.
  return code === 1 || code === 2 || code === 4 || code === 17 || code === 613 || code === 80007;
}
