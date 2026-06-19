'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { ChecklistResponse } from './types';

/**
 * Hook do checklist "Primeiros passos" (F43-S06). Consome `GET /api/onboarding/checklist`
 * (F43-S04), gated por `workspace.edit` (ADMIN/OWNER) no servidor — para membros sem
 * essa permissão a chamada falha (403), então o widget só é consultado quando o caller
 * pode fazer onboarding. `retry: false` para não martelar o 403.
 *
 * Separado do `useOnboardingState` (que serve o wizard): o checklist é um recurso
 * próprio com sua própria query key, e revalida com mais frequência porque seus passos
 * refletem ações que o usuário acabou de fazer (conectar canal, publicar fluxo, etc.).
 */
export const checklistKeys = {
  all: ['onboarding', 'checklist'] as const,
};

export function useChecklist(enabled = true) {
  return useQuery<ChecklistResponse>({
    queryKey: checklistKeys.all,
    queryFn: () => api.get<ChecklistResponse>('/api/onboarding/checklist'),
    enabled,
    // Passos refletem ações recentes — janela curta antes de revalidar ao voltar à aba.
    staleTime: 60 * 1000,
    retry: false,
  });
}
