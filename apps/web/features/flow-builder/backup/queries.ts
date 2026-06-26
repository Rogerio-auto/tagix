'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import { flowKeys } from '../list/queries';
import type { BackupEnvelope, ImportResult, PreviewResult } from './types';

/**
 * Hooks do Backup de Flows (F50-S05). Consome a API de F50-S04:
 *   GET  /api/flows/backup/export   → bundle (download)
 *   POST /api/flows/backup/preview  → resumo (sem escrita)
 *   POST /api/flows/backup/import   → cria flows draft
 */
export function useExportFlows() {
  return useMutation({
    mutationFn: () => api.get<BackupEnvelope>('/api/flows/backup/export'),
  });
}

export function usePreviewImport() {
  return useMutation({
    mutationFn: (envelope: unknown) =>
      api.post<PreviewResult>('/api/flows/backup/preview', { envelope }),
  });
}

export function useImportFlows() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { envelope: unknown; confirmedChecksum: string }) =>
      api.post<ImportResult>('/api/flows/backup/import', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: flowKeys.lists() }),
  });
}
