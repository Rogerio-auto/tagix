'use client';

import { can } from '@hm/shared';
import { Button, Drawer, Skeleton, useToast } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { formatTime } from '@/shared/lib/locale';
import { useAuthStore } from '@/shared/stores/auth.store';
import { ExecutionStatusPill, isExecutionActive } from '../shared/execution-status';
import { useCancelConversationExecution, useExecutionDetail } from './queries';

interface Props {
  executionId: string | null;
  conversationId: string;
  onClose: () => void;
}

/**
 * Detalhe de uma execução de flow (FX-031c) no DS 3.0 (F72-S07): painel lateral (UX §2.3,
 * detalhe em Drawer, não modal), status, nó atual e o log com horário em mono.
 * Estados: carregando (skeleton), não encontrada. Cancelar com loading (UX §2.7) e guarda
 * de só leitura (F71-S17).
 */
export function ExecutionDetailDrawer({ executionId, conversationId, onClose }: Props) {
  const role = useAuthStore((s) => s.auth?.role);
  const canCancel = role ? can(role, 'flow.cancel') : false;
  const { toast } = useToast();
  const detail = useExecutionDetail(executionId);
  const cancel = useCancelConversationExecution(conversationId);

  const handleCancel = async () => {
    if (!executionId) return;
    try {
      await cancel.mutateAsync(executionId);
      toast({ variant: 'success', title: 'Execução cancelada' });
      onClose();
    } catch {
      toast({ variant: 'error', title: 'Não foi possível cancelar', description: 'Tente novamente.' });
    }
  };

  const exec = detail.data?.execution;
  const logs = detail.data?.logs ?? [];

  return (
    <Drawer
      open={!!executionId}
      onClose={onClose}
      title={exec?.flowName ?? 'Execução do flow'}
      description="Acompanhe por onde a automação passou nesta conversa."
      footer={
        exec && canCancel && isExecutionActive(exec.status) ? (
          <ReadOnlyGuard>
            <Button variant="danger" loading={cancel.isPending} onClick={() => void handleCancel()}>
              Cancelar execução
            </Button>
          </ReadOnlyGuard>
        ) : undefined
      }
    >
      {detail.isLoading ? (
        <div className="space-y-3" aria-busy aria-label="Carregando execução">
          <Skeleton className="h-6 w-32 rounded-pill" />
          <Skeleton className="h-40 rounded-sm" />
        </div>
      ) : !exec ? (
        <p className="text-sm text-text-low">Execução não encontrada. Ela pode ter sido removida.</p>
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-sm">
            <dt className="text-text-low">Status</dt>
            <dd>
              <ExecutionStatusPill status={exec.status} />
            </dd>
            <dt className="text-text-low">Início</dt>
            <dd className="font-mono tabular-nums text-text-mid">{formatTime(exec.startedAt)}</dd>
            <dt className="text-text-low">Nó atual</dt>
            <dd className="truncate font-mono text-xs text-text-mid">{exec.currentNodeId ?? '—'}</dd>
          </dl>

          {exec.lastError && (
            <p className="rounded-sm border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">{exec.lastError}</p>
          )}

          <section aria-labelledby="execution-log-title" className="space-y-2">
            <h3 id="execution-log-title" className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-low">
              Registro
            </h3>
            {logs.length === 0 ? (
              <p className="text-xs text-text-low">Sem registros ainda.</p>
            ) : (
              <ol className="max-h-[50dvh] divide-y divide-border overflow-y-auto rounded-sm border border-border bg-surface-2">
                {logs.map((log) => (
                  <li key={log.id} className="grid grid-cols-[auto_1fr] gap-x-3 px-3 py-2 text-xs">
                    <span className="font-mono tabular-nums text-text-low">{formatTime(log.createdAt)}</span>
                    <span className="min-w-0">
                      <span className="block font-mono text-[11px] text-text-low">{log.nodeType}</span>
                      <span className="text-text">{log.message ?? '—'}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}
