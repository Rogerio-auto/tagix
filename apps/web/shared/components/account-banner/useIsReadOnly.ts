'use client';

import { useAuthStore } from '@/shared/stores/auth.store';
import { isWorkspaceReadOnly } from './banner-priority';

/**
 * `true` quando a empresa ativa está em modo só leitura (`expired`/`canceled`, ou
 * trial vencido). Para desabilitar botões de escrita com tooltip onde for barato
 * — a guarda real é do servidor (402).
 */
export function useIsReadOnly(): boolean {
  const workspace = useAuthStore((s) => s.workspace);
  return isWorkspaceReadOnly(workspace, Date.now());
}

/** Texto padrão do tooltip de um botão de escrita bloqueado. */
export const READ_ONLY_TOOLTIP = 'Modo só leitura: escolha um plano para voltar a editar.';
