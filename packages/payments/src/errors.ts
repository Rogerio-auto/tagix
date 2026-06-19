/**
 * Erro normalizado do provider de pagamento.
 *
 * A AbacatePay devolve o envelope `{ data, success, error }`; em falha, `error`
 * traz uma mensagem. `PaymentProviderError` unifica isso com o status HTTP e a
 * flag de retry — sem nunca carregar a API key/secret no payload de log.
 */

/** Categoria do erro, para o caller decidir como reagir (e mapear telemetria). */
export type PaymentErrorKind =
  /** Falha de rede / timeout (status 0). */
  | 'network'
  /** Resposta do gateway com shape inesperado (falha de validação Zod). */
  | 'invalid_response'
  /** Erro lógico/negócio retornado pelo gateway (4xx com `success:false`). */
  | 'provider'
  /** Erro de autenticação (401/403) — key inválida/expirada. */
  | 'auth'
  /** Rate limit (429). */
  | 'rate_limited'
  /** Erro de servidor do gateway (5xx). */
  | 'server';

export class PaymentProviderError extends Error {
  /** Status HTTP (0 = falha de rede/timeout). */
  readonly httpStatus: number;
  /** Categoria normalizada do erro. */
  readonly kind: PaymentErrorKind;
  /** `true` se a falha é transitória e o cliente pode tentar de novo. */
  readonly retryable: boolean;
  /**
   * Corpo bruto da resposta, para diagnóstico. NUNCA inclui credenciais — o
   * client jamais coloca a API key/secret aqui.
   */
  readonly raw?: unknown;

  constructor(
    message: string,
    opts: {
      httpStatus: number;
      kind: PaymentErrorKind;
      retryable?: boolean;
      raw?: unknown;
    },
  ) {
    super(message);
    this.name = 'PaymentProviderError';
    this.httpStatus = opts.httpStatus;
    this.kind = opts.kind;
    this.retryable = opts.retryable ?? false;
    this.raw = opts.raw;
    // Mantém a cadeia de protótipo ao estender Error em ES2022.
    Object.setPrototypeOf(this, PaymentProviderError.prototype);
  }

  /** Deriva o `kind` a partir do status HTTP. */
  static kindFromStatus(httpStatus: number): PaymentErrorKind {
    if (httpStatus === 0) return 'network';
    if (httpStatus === 401 || httpStatus === 403) return 'auth';
    if (httpStatus === 429) return 'rate_limited';
    if (httpStatus >= 500) return 'server';
    return 'provider';
  }

  /** Constrói a partir de um status + corpo já lido (envelope ou texto). */
  static fromResponse(httpStatus: number, body: unknown, fallbackMessage?: string): PaymentProviderError {
    const kind = PaymentProviderError.kindFromStatus(httpStatus);
    const message = extractErrorMessage(body) ?? fallbackMessage ?? `Payment provider error (HTTP ${httpStatus})`;
    return new PaymentProviderError(message, {
      httpStatus,
      kind,
      retryable: isRetryableStatus(httpStatus),
      raw: body,
    });
  }
}

/** 429 + 5xx + rede (0) são transitórios. */
export function isRetryableStatus(httpStatus: number): boolean {
  return httpStatus === 0 || httpStatus === 429 || httpStatus >= 500;
}

/**
 * Extrai uma mensagem de erro do envelope da AbacatePay.
 * Aceita tanto `{ error: "msg" }` quanto `{ error: { message } }` (defensivo).
 */
function extractErrorMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const error = (body as { error: unknown }).error;
  if (typeof error === 'string') return error.length > 0 ? error : undefined;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  }
  return undefined;
}
