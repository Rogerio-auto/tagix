/**
 * Copy de erro do editor de campanha (UX §2.11: o QUE aconteceu, POR QUE, o que FAZER).
 * Pura → testável. Nada de "algo deu errado": cada status vira uma causa acionável.
 */
import { ApiError } from '@/shared/lib/api-client';

export interface ErrorCopy {
  title: string;
  reason: string;
  whatToDo: string;
  reference?: string;
  /** 404/403 não se resolvem com retry — a UI esconde o botão "Tentar de novo". */
  retryable: boolean;
}

/** Falha ao carregar a campanha para edição (`GET /api/campaigns/:id`). */
export function describeLoadError(error: unknown): ErrorCopy {
  const status = error instanceof ApiError ? error.status : 0;
  const reference = error instanceof ApiError ? error.ref : undefined;
  const base = reference ? { reference } : {};

  if (status === 404) {
    return {
      ...base,
      title: 'Campanha não encontrada',
      reason: 'Ela foi removida ou pertence a outro workspace.',
      whatToDo: 'Volte para a lista e abra uma campanha existente.',
      retryable: false,
    };
  }
  if (status === 401 || status === 403) {
    return {
      ...base,
      title: 'Sem acesso a esta campanha',
      reason:
        status === 401
          ? 'Sua sessão expirou.'
          : 'Seu perfil não tem permissão para ver campanhas.',
      whatToDo:
        status === 401
          ? 'Entre de novo e reabra a campanha.'
          : 'Peça a permissão de campanhas a um administrador do workspace.',
      retryable: status === 401,
    };
  }
  if (status >= 500) {
    return {
      ...base,
      title: 'Não foi possível carregar a campanha',
      reason: 'A API respondeu com erro interno.',
      whatToDo: 'Tente de novo em instantes. Se persistir, envie a referência ao suporte.',
      retryable: true,
    };
  }
  return {
    ...base,
    title: 'Não foi possível carregar a campanha',
    reason: 'A conexão com a API falhou.',
    whatToDo: 'Verifique sua conexão e tente de novo.',
    retryable: true,
  };
}

/** Falha ao salvar um passo do wizard (create/update/steps/recipients/validate). */
export function describeSaveError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'Só campanhas em rascunho podem ser editadas.';
    if (error.status === 401) return 'Sua sessão expirou. Entre de novo para salvar.';
    if (error.status === 403) return 'Você não tem permissão para editar campanhas.';
    if (error.status === 400) return 'Revise os campos deste passo: a API recusou o payload.';
    if (error.status === 404) return 'Campanha não encontrada (pode ter sido removida).';
  }
  return 'Falha ao salvar o passo. Tente de novo.';
}
