'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { SubmitFeedbackInput } from './types';

/**
 * Hook de marcação de feedback de citação (F3-S07). Persiste em kb_feedback via
 * POST /api/knowledge/feedback. Idempotente no servidor (dedup razoavel); a UI
 * reflete o estado localmente sem refetch.
 */
export function useSubmitKbFeedback() {
  return useMutation<{ id: string; deduped: boolean }, Error, SubmitFeedbackInput>({
    mutationFn: (input) =>
      api.post<{ id: string; deduped: boolean }>('/api/knowledge/feedback', input),
  });
}
