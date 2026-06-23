'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { flowEditorService, type EditorEdge, type EditorNode } from '../services';

export const editorKeys = {
  detail: (id: string) => ['flow-editor', id] as const,
};

export function useFlow(id: string) {
  return useQuery({
    queryKey: editorKeys.detail(id),
    queryFn: () => flowEditorService.get(id),
    enabled: id.length > 0,
  });
}

export function useSaveFlow(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: {
      name?: string;
      nodes: EditorNode[];
      edges: EditorEdge[];
      triggerType?: string;
      triggerConfig?: Record<string, unknown>;
    }) =>
      flowEditorService.update(id, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: editorKeys.detail(id) }),
  });
}

/**
 * Renomeia o flow (PUT /api/flows/:id { name }) sem tocar em nodes/edges. Invalida o detalhe
 * do editor E a lista de flows para o novo nome refletir em ambos. Renomear é só metadado —
 * não exige republicar (não cria nova version).
 */
export function useRenameFlow(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => flowEditorService.update(id, { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: editorKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: ['flows', 'list'] });
    },
  });
}

export function usePublishFlow(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => flowEditorService.publish(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: editorKeys.detail(id) }),
  });
}

/**
 * Ações de ciclo de vida do flow no editor (F36-S11 — rodapé mobile): pausar (unpublish) e
 * arquivar. Espelham os endpoints de F4-S08. Invalida o detalhe e a lista após a mutação.
 */
export function useFlowLifecycleAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: 'unpublish' | 'archive') => flowEditorService.lifecycle(id, action),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: editorKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: ['flows', 'list'] });
    },
  });
}
