/**
 * Mapa de códigos de erro WhatsApp Cloud API (Graph).
 *
 * A Meta devolve `error.code` numérico nas falhas de envio. Aqui mapeamos os
 * códigos WA mais comuns → mensagem amigável + se vale retry, para que o worker
 * outbound decida nack/descarte sem inspecionar strings frágeis.
 *
 * Refs: WhatsApp Cloud API "Error codes" (developers.facebook.com).
 */

/** Entrada do mapa de erros WA. */
export interface WaErrorInfo {
  /** Mensagem curta orientada ao operador. */
  readonly message: string;
  /** `true` se a falha é transitória e o envio pode ser reenfileirado. */
  readonly retryable: boolean;
}

/**
 * Códigos WA conhecidos. Não é exaustivo — `mapWaError` cai num default seguro
 * para códigos não listados.
 */
export const WA_ERROR_CODES: Readonly<Record<number, WaErrorInfo>> = {
  // --- Throttling / temporários (retryable) ---
  130429: { message: 'Limite de taxa (rate limit) atingido pela conta WABA.', retryable: true },
  131000: { message: 'Erro genérico/temporário no envio.', retryable: true },
  131016: { message: 'Serviço WhatsApp temporariamente indisponível.', retryable: true },
  131026: {
    // Mensagem não entregue (destinatário não tem WhatsApp, número inválido, etc.).
    message: 'Mensagem não entregável (número sem WhatsApp ou indisponível).',
    retryable: false,
  },

  // --- Janela / template (não-retryable: exigem ação do operador) ---
  131047: {
    message:
      'Fora da janela de 24h: requer template (HSM) para reabrir a conversa.',
    retryable: false,
  },
  131051: { message: 'Tipo de mensagem não suportado para este destinatário.', retryable: false },
  130472: {
    message: 'Usuário faz parte de experimento; mensagem não entregue (regra de marketing).',
    retryable: false,
  },

  // --- Template inválido (não-retryable) ---
  132000: { message: 'Template: número de parâmetros não confere.', retryable: false },
  132001: {
    message: 'Template não existe ou não foi aprovado no idioma informado.',
    retryable: false,
  },
  132005: { message: 'Texto do template traduzido excede o limite.', retryable: false },
  132007: { message: 'Template viola política de conteúdo.', retryable: false },
  132012: { message: 'Template: formato de parâmetro inválido.', retryable: false },
  132015: { message: 'Template pausado por baixa qualidade.', retryable: false },
  132016: { message: 'Template desabilitado por qualidade muito baixa.', retryable: false },

  // --- Auth / config (não-retryable até reconfigurar) ---
  131008: { message: 'Parâmetro obrigatório ausente na requisição.', retryable: false },
  131009: { message: 'Valor de parâmetro inválido na requisição.', retryable: false },
  131031: { message: 'Conta WABA bloqueada por violação de política.', retryable: false },
  133010: { message: 'Número de telefone não registrado na Cloud API.', retryable: false },
  100: { message: 'Parâmetro inválido na chamada Graph.', retryable: false },

  // --- Rate limit Graph genérico (retryable) ---
  4: { message: 'Limite de chamadas da aplicação atingido.', retryable: true },
  80007: { message: 'Limite de taxa da conta atingido.', retryable: true },
  368: { message: 'Ação bloqueada temporariamente (spam/abuse).', retryable: true },
};

/** Default quando o código não está no mapa. */
const WA_DEFAULT: WaErrorInfo = {
  message: 'Erro desconhecido do WhatsApp Cloud API.',
  retryable: false,
};

/**
 * Resolve um código WA para `{ message, retryable }`. Códigos desconhecidos
 * caem no default não-retryable.
 */
export function mapWaError(code: number | undefined): WaErrorInfo {
  if (code === undefined) return WA_DEFAULT;
  return WA_ERROR_CODES[code] ?? WA_DEFAULT;
}
