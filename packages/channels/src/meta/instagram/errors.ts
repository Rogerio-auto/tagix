/**
 * Erros tipados específicos do Instagram Messaging (Graph API v23.0).
 *
 * O Graph compartilha o shape de erro com WhatsApp (`MetaError` em
 * `../../shared/errors`); este módulo adiciona apenas os códigos de domínio IG
 * que o adapter/worker mapeiam para decisões de produto (sem HSM, janela 24h
 * fechada, etc.). Tudo aditivo — não toca WhatsApp.
 */

/** Códigos de erro de domínio IG emitidos pelo adapter (não vêm do Graph). */
export const IG_ERROR_CODES = {
  /** Instagram não possui templates HSM (INSTAGRAM.md §5.2). */
  NO_HSM: 'IG_NO_HSM',
  /** Tentativa de envio fora da janela 24h sem MESSAGE_TAG válido (§6). */
  WINDOW_CLOSED: 'IG_WINDOW_CLOSED',
  /** Canal sem `igUserId` configurado. */
  NO_IG_USER_ID: 'IG_NO_USER_ID',
  /** Payload interativo não suportado em IG. */
  INTERACTIVE_INVALID: 'IG_INTERACTIVE_INVALID',
  /** `kind` de OutboundJob incompatível com o provider IG. */
  KIND_UNSUPPORTED: 'IG_KIND_UNSUPPORTED',
  /** Resposta da Graph sem id de mensagem. */
  NO_MESSAGE_ID: 'IG_NO_MESSAGE_ID',
  /** Erro genérico (Graph com código) — prefixo `IG_<code>`. */
  GENERIC: 'IG_ERROR',
  /** Erro inesperado/desconhecido. */
  UNKNOWN: 'IG_UNKNOWN',
} as const;

export type IgErrorCode = (typeof IG_ERROR_CODES)[keyof typeof IG_ERROR_CODES];

/** Mensagens humanas canônicas por código de domínio. */
export const IG_ERROR_MESSAGES: Record<IgErrorCode, string> = {
  [IG_ERROR_CODES.NO_HSM]:
    'Instagram não suporta templates HSM. Use generic_template/quick_replies na janela 24h ou a tag HUMAN_AGENT.',
  [IG_ERROR_CODES.WINDOW_CLOSED]:
    'Janela de mensagens do Instagram fechada. Fora de 24h exige um MESSAGE_TAG válido (HUMAN_AGENT até 7 dias).',
  [IG_ERROR_CODES.NO_IG_USER_ID]: 'Canal Instagram sem igUserId configurado.',
  [IG_ERROR_CODES.INTERACTIVE_INVALID]: 'Payload interativo inválido para Instagram.',
  [IG_ERROR_CODES.KIND_UNSUPPORTED]: 'Tipo de envio não suportado pelo Instagram.',
  [IG_ERROR_CODES.NO_MESSAGE_ID]: 'Resposta da Graph sem message_id.',
  [IG_ERROR_CODES.GENERIC]: 'Erro da Graph API (Instagram).',
  [IG_ERROR_CODES.UNKNOWN]: 'Erro desconhecido no envio Instagram.',
};

/**
 * Erro de serialização de payload interativo IG (quick_replies/generic_template/
 * button_template malformado). Espelha `InteractiveSerializeError` do WA.
 */
export class IgInteractiveSerializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IgInteractiveSerializeError';
    Object.setPrototypeOf(this, IgInteractiveSerializeError.prototype);
  }
}
