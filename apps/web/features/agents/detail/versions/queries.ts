'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import { queryKeys } from '../../queries';
import type { DraftInput, PromptVersion, PromptVersionDiff } from './types';

/**
 * React Query hooks do versionamento de prompt (F56-S31). Consome os endpoints do
 * versions router (`apps/api/src/routes/agents/versions.ts`). Toda mutação que
 * altera a live (publish/rollback/PATCH-hook) invalida também o detalhe do agente,
 * porque `agents.system_prompt`/`model` passam a espelhar a nova live.
 */

export const versionKeys = {
  list: (agentId: string) => [...queryKeys.detail(agentId), 'versions'] as const,
  diff: (agentId: string, from: number, to: number) =>
    [...queryKeys.detail(agentId), 'versions', 'diff', from, to] as const,
};

/** Histórico de versões (mais recente primeiro, como devolvido pela API). */
export function useAgentVersions(agentId: string | undefined) {
  return useQuery({
    queryKey: versionKeys.list(agentId ?? ''),
    enabled: Boolean(agentId),
    queryFn: () => api.get<{ versions: PromptVersion[] }>(`/api/agents/${agentId}/versions`),
  });
}

/** Diff entre duas versões (por número). Habilitado só quando ambos definidos. */
export function useAgentVersionDiff(
  agentId: string | undefined,
  from: number | null,
  to: number | null,
) {
  return useQuery({
    queryKey: versionKeys.diff(agentId ?? '', from ?? 0, to ?? 0),
    enabled: Boolean(agentId) && from !== null && to !== null,
    queryFn: () =>
      api.get<PromptVersionDiff>(`/api/agents/${agentId}/versions/diff?from=${from}&to=${to}`),
  });
}

/** Cria um rascunho (staging; não aplica ao agente). Invalida o histórico. */
export function useCreateDraft(agentId: string) {
  const qc = useQueryClient();
  return useMutation<{ version: PromptVersion }, Error, DraftInput>({
    mutationFn: (input) => api.post<{ version: PromptVersion }>(`/api/agents/${agentId}/versions`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: versionKeys.list(agentId) });
    },
  });
}

/** Edita um rascunho existente. Invalida o histórico. */
export function useUpdateDraft(agentId: string) {
  const qc = useQueryClient();
  return useMutation<{ version: PromptVersion }, Error, { versionId: string; input: DraftInput }>({
    mutationFn: ({ versionId, input }) =>
      api.patch<{ version: PromptVersion }>(`/api/agents/${agentId}/versions/${versionId}`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: versionKeys.list(agentId) });
    },
  });
}

/** Descarta um rascunho. Invalida o histórico. */
export function useDiscardDraft(agentId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (versionId) => api.delete<void>(`/api/agents/${agentId}/versions/${versionId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: versionKeys.list(agentId) });
    },
  });
}

/** Publica um rascunho (draft→live). Invalida histórico + detalhe do agente. */
export function usePublishVersion(agentId: string) {
  const qc = useQueryClient();
  return useMutation<{ version: PromptVersion }, Error, string>({
    mutationFn: (versionId) =>
      api.post<{ version: PromptVersion }>(`/api/agents/${agentId}/versions/${versionId}/publish`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: versionKeys.list(agentId) });
      void qc.invalidateQueries({ queryKey: queryKeys.detail(agentId) });
    },
  });
}

/** Rollback: republica uma versão antiga como nova live. Invalida histórico + detalhe. */
export function useRollbackVersion(agentId: string) {
  const qc = useQueryClient();
  return useMutation<{ version: PromptVersion }, Error, { versionId: string; note?: string }>({
    mutationFn: ({ versionId, note }) =>
      api.post<{ version: PromptVersion }>(`/api/agents/${agentId}/versions/${versionId}/rollback`, {
        note,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: versionKeys.list(agentId) });
      void qc.invalidateQueries({ queryKey: queryKeys.detail(agentId) });
    },
  });
}
