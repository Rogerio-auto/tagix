'use client';

import { X } from 'lucide-react';
import { Button } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { useCancelExecution, useFlowExecutions } from '../hooks/useFlowExecutions';

const STATUS_TONE: Record<string, string> = {
  running: 'bg-accent/15 text-accent',
  waiting: 'bg-warning/15 text-warning',
  completed: 'bg-success/15 text-success',
  failed: 'bg-danger/15 text-danger',
  cancelled: 'bg-surface-3 text-text-low',
};

/** Painel direito de execucoes ativas (FLOW_BUILDER secao 9.5). Lista + cancelar. */
export function ExecutionsPanel({ flowId }: { flowId: string }) {
  const executions = useFlowExecutions(flowId);
  const cancel = useCancelExecution(flowId);
  const rows = executions.data?.executions ?? [];
  const active = rows.filter((e) => e.status === 'running' || e.status === 'waiting');

  return (
    <div className="space-y-2">
      <p className="font-head text-xs font-semibold uppercase tracking-wide text-text-low">
        Execucoes ativas ({active.length})
      </p>
      {active.length === 0 ? (
        <p className="text-xs text-text-low">Nenhuma execucao em andamento.</p>
      ) : (
        <ul className="space-y-1.5">
          {active.map((exec) => (
            <li
              key={exec.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border-2 bg-surface-2 px-2.5 py-1.5"
            >
              <div className="min-w-0">
                <span
                  className={cn(
                    'rounded-pill px-1.5 py-0.5 text-[10px]',
                    STATUS_TONE[exec.status] ?? 'bg-surface-3 text-text-low',
                  )}
                >
                  {exec.status}
                </span>
                <p className="mt-0.5 truncate font-mono text-[10px] text-text-low">{exec.id}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Cancelar execucao"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(exec.id)}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
