'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { flowEditorService } from '../services';

export function useFlowExecutions(flowId: string) {
  return useQuery({
    queryKey: ['flow-executions', flowId],
    queryFn: () => flowEditorService.executions(flowId),
    enabled: flowId.length > 0,
    refetchInterval: 5000,
  });
}

export function useCancelExecution(flowId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (executionId: string) => flowEditorService.cancelExecution(executionId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['flow-executions', flowId] }),
  });
}
