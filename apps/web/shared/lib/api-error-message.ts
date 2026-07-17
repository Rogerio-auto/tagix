/**
 * Helper ÚNICO de mensagem de erro (F56-S29 · AUDITORIA_TECNICA §3.5).
 *
 * Deriva uma mensagem amigável e ACIONÁVEL a partir de um `ApiError` — em vez de
 * dezenas de telas improvisarem "conexão falhou" para 401/403/500/rede. Cada status
 * vira uma causa em português claro (o QUÊ) + um motivo (por QUÊ) + o que FAZER
 * (UX §2.11), e o `ref` (header `X-Error-Ref`, anexado pelo backend em 5xx — F56-S19)
 * é SEMPRE exposto para o usuário citar no suporte e reduzir tempo de ticket.
 *
 * PURO e sem dependência de React → testável isolado e reusável em qualquer
 * superfície (ErrorState, toasts, banners de feature). Nada de stack trace vaza:
 * a mensagem crua do erro nunca é mostrada; só a copy curada + a referência.
 */
import { ApiError } from '@/shared/lib/api-client';

export interface ApiErrorMessage {
  /** O QUÊ falhou, curto. Ex.: "Sua sessão expirou". */
  title: string;
  /** POR QUÊ, em linguagem simples. Ex.: "Você ficou muito tempo sem atividade". */
  reason: string;
  /** O QUE FAZER — sempre acionável. Ex.: "Entre de novo para continuar". */
  whatToDo: string;
  /** Referência técnica copiável (`X-Error-Ref`), quando o backend enviou. */
  reference?: string;
  /** HTTP status observado. `0` = falha de rede / erro não-HTTP. */
  status: number;
  /** 403/404 não se resolvem com retry cego — a UI pode ocultar "Tentar de novo". */
  retryable: boolean;
  /** 401 → precisa relogar; a UI pode oferecer o CTA "Entrar de novo". */
  requiresReauth: boolean;
}

/** Extrai `status`/`ref` de um erro desconhecido sem confiar no shape. */
function unwrap(error: unknown): { status: number; reference?: string } {
  if (error instanceof ApiError) {
    return { status: error.status, reference: error.ref };
  }
  return { status: 0 };
}

/**
 * Deriva a mensagem amigável de qualquer erro. Aceita `unknown` (o que os
 * `onError`/`catch` realmente entregam) — só um `ApiError` traz `status`/`ref`;
 * o resto cai no ramo de rede.
 */
export function describeApiError(error: unknown): ApiErrorMessage {
  const { status, reference } = unwrap(error);
  const base = reference ? { reference } : {};

  if (status === 401) {
    return {
      ...base,
      status,
      title: 'Sua sessão expirou',
      reason: 'Você ficou tempo demais sem atividade e precisa entrar de novo.',
      whatToDo: 'Entre novamente para continuar de onde parou.',
      retryable: true,
      requiresReauth: true,
    };
  }

  if (status === 403) {
    return {
      ...base,
      status,
      title: 'Sem permissão',
      reason: 'Seu perfil não tem acesso a este recurso.',
      whatToDo: 'Peça acesso a um administrador do workspace.',
      retryable: false,
      requiresReauth: false,
    };
  }

  if (status === 404) {
    return {
      ...base,
      status,
      title: 'Não encontrado',
      reason: 'O item foi removido ou nunca existiu.',
      whatToDo: 'Volte e escolha outro item da lista.',
      retryable: false,
      requiresReauth: false,
    };
  }

  if (status === 409) {
    return {
      ...base,
      status,
      title: 'Este item mudou enquanto você editava',
      reason: 'Alguém (ou outra aba) alterou o registro antes de você salvar.',
      whatToDo: 'Recarregue para ver a versão atual e tente de novo.',
      retryable: true,
      requiresReauth: false,
    };
  }

  if (status === 422 || status === 400) {
    return {
      ...base,
      status,
      title: 'Dados inválidos',
      reason: 'A API recusou os dados enviados.',
      whatToDo: 'Revise os campos destacados e tente de novo.',
      retryable: false,
      requiresReauth: false,
    };
  }

  if (status === 429) {
    return {
      ...base,
      status,
      title: 'Muitas tentativas',
      reason: 'Você fez requisições rápido demais e o servidor pediu uma pausa.',
      whatToDo: 'Aguarde alguns instantes e tente de novo.',
      retryable: true,
      requiresReauth: false,
    };
  }

  if (status >= 500) {
    return {
      ...base,
      status,
      title: 'Erro no servidor',
      reason: 'A API respondeu com um erro interno.',
      whatToDo: 'Tente de novo em instantes. Se persistir, cite a referência ao suporte.',
      retryable: true,
      requiresReauth: false,
    };
  }

  // status 0 (rede/erro não-HTTP) ou qualquer código não mapeado.
  return {
    ...base,
    status,
    title: 'Falha de conexão',
    reason: 'Não conseguimos falar com o servidor.',
    whatToDo: 'Verifique sua internet e tente de novo.',
    retryable: true,
    requiresReauth: false,
  };
}
