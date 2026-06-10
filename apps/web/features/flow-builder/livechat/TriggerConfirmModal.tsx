'use client';

import { Button, Modal, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { useTriggerFlow, type ManualFlow } from './queries';

interface Props {
  flow: ManualFlow | null;
  conversationId: string;
  onClose: () => void;
}

/** Modal curto de confirmacao ao disparar um flow manual (FX-031a). */
export function TriggerConfirmModal({ flow, conversationId, onClose }: Props) {
  const { toast } = useToast();
  const trigger = useTriggerFlow();

  const handleConfirm = async () => {
    if (!flow) return;
    try {
      await trigger.mutateAsync({ flowId: flow.id, conversationId });
      toast({ variant: 'success', title: 'Flow disparado', description: flow.name });
      onClose();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Tente novamente.';
      toast({ variant: 'error', title: 'Falha ao disparar', description: message });
    }
  };

  return (
    <Modal open={!!flow} onClose={onClose} title="Disparar flow" className="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-text-low">
          Disparar o flow <span className="font-medium text-text">{flow?.name}</span> nesta
          conversa? As acoes do flow serao executadas imediatamente.
        </p>
        <div className="flex items-center justify-end gap-2 border-t border-border-2 pt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={trigger.isPending}
            onClick={() => void handleConfirm()}
          >
            {trigger.isPending ? 'Disparando...' : 'Disparar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
