/** Erros seguros e acionaveis do conector de modelos da Meta. */

export type MetaTemplateErrorKind =
  | 'validation'
  | 'authentication'
  | 'permission'
  | 'payload'
  | 'rate_limit'
  | 'unavailable'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'pagination';

export type MetaTemplateErrorPermanence = 'permanent' | 'transient';

export interface MetaTemplateValidationIssue {
  /** Caminho estrutural, nunca o valor fornecido pelo usuario. */
  readonly path: string;
  readonly code: string;
}

interface MetaTemplateErrorOptions {
  readonly permanence: MetaTemplateErrorPermanence;
  readonly httpStatus?: number;
  readonly graphCode?: number;
  readonly retryAfterMs?: number;
  readonly issues?: readonly MetaTemplateValidationIssue[];
}

const SAFE_MESSAGES: Readonly<Record<MetaTemplateErrorKind, string>> = {
  validation: 'The message template is structurally invalid.',
  authentication: 'Meta authentication failed.',
  permission: 'Meta permission was denied.',
  payload: 'Meta rejected the request.',
  rate_limit: 'Meta rate limit was reached.',
  unavailable: 'Meta is temporarily unavailable.',
  timeout: 'Meta request timed out.',
  network: 'Meta request failed due to a network error.',
  invalid_response: 'Meta returned an invalid response.',
  pagination: 'Meta pagination could not be completed safely.',
};

/**
 * Nao guarda body, URL, token nem mensagem externa. Assim, serializar ou logar
 * este erro nao vaza credenciais/conteudo de modelos.
 */
export class MetaTemplateError extends Error {
  readonly kind: MetaTemplateErrorKind;
  readonly permanence: MetaTemplateErrorPermanence;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly graphCode?: number;
  readonly retryAfterMs?: number;
  readonly issues?: readonly MetaTemplateValidationIssue[];

  constructor(kind: MetaTemplateErrorKind, options: MetaTemplateErrorOptions) {
    super(SAFE_MESSAGES[kind]);
    this.name = 'MetaTemplateError';
    this.kind = kind;
    this.permanence = options.permanence;
    this.retryable = options.permanence === 'transient';
    if (options.httpStatus !== undefined) this.httpStatus = options.httpStatus;
    if (options.graphCode !== undefined) this.graphCode = options.graphCode;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
    if (options.issues !== undefined) this.issues = options.issues;
    Object.setPrototypeOf(this, MetaTemplateError.prototype);
  }
}

export function templateValidationError(
  issues: readonly MetaTemplateValidationIssue[],
): MetaTemplateError {
  return new MetaTemplateError('validation', { permanence: 'permanent', issues });
}
