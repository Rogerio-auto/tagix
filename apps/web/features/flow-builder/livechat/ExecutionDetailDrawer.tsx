'use client';

import { can } from '@hm/shared';
import { Button, Modal, useToast } from '@hm/ui';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useCancelConversationExecution, useExecutionDetail } from './queries';

interface Props {
  executionId: string | null;
  conversationId: string;
  onClose: () => void;
}

/** Drawer/modal de detalhe de uma execucao: logs, current node, cancelar (FX-031c). */
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
      toast({ variant: 'success', title: 'Execucao cancelada' });
      onClose();
    } catch {
      toast({ variant: 'error', title: 'Falha ao cancelar' });
    }
  };

  const exec = detail.data?.execution;
  const logs = detail.data?.logs ?? [];

  return (
    <Modal open={!!executionId} onClose={onClose} title="Execucao do flow" className="max-w-lg">
      <div className="space-y-3">
        {detail.isLoading ? (
          <p className="text-sm text-text-low">Carregando...</p>
        ) : !exec ? (
          <p className="text-sm text-text-low">Execucao nao encontrada.</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text">Status: {exec.status}</p>
                <p className="text-xs text-text-low">Node atual: {exec.currentNodeId ?? '—'}</p>
              </div>
              {canCancel && (exec.status === 'running' || exec.status === 'waiting') && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={cancel.isPending}
                  onClick={() => void handleCancel()}
                >
                  Cancelar
                </Button>
              )}
            </div>

            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border-2 bg-surface-2 p-2">
              {logs.length === 0 ? (
                <p className="text-xs text-text-low">Sem logs ainda.</p>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex gap-2 text-[11px]">
                    <span className="shrink-0 font-mono text-text-low">{log.nodeType}</span>
                    <span className="text-text">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
