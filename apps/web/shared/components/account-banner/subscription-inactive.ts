import type { ToastOptions } from '@hm/ui';
import type { ApiError } from '@/shared/lib/api-client';

export interface SubscriptionInactiveDeps {
  toast: (opts: ToastOptions) => unknown;
  /** Reflete o só leitura na UI (faixa) sem esperar outro `/api/me`. */
  markInactive: () => void;
  /** Chave da "sessão de tela" (a empresa ativa): uma explicação por chave. */
  scopeKey: () => string;
}

/** Conteúdo do toast: o quê, por quê e o que fazer (UX §2.11). */
export const READ_ONLY_TOAST: ToastOptions = {
  variant: 'warn',
  title: 'Sua empresa está em modo só leitura',
  description: 'Não dá para salvar alterações agora. Escolha um plano em Configurações > Assinatura para voltar a editar.',
  duration: 8000,
};

/**
 * Handler central do `402 subscription_inactive` (F71-S08). NÃO desloga e não mexe
 * na sessão: só reflete o só leitura na UI e explica UMA vez por empresa/tela —
 * vários cliques em "salvar" não empilham toasts.
 */
export function createSubscriptionInactiveHandler(
  deps: SubscriptionInactiveDeps,
): (error: ApiError) => void {
  const notified = new Set<string>();
  return () => {
    deps.markInactive();
    const key = deps.scopeKey();
    if (notified.has(key)) return;
    notified.add(key);
    deps.toast(READ_ONLY_TOAST);
  };
}
