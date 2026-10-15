'use client';

import { Button, Modal, useToast } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { ApiError } from '@/shared/lib/api-client';
import { useTriggerFlow, type ManualFlow } from './queries';

interface Props {
  flow: ManualFlow | null;
  conversationId: string;
  onClose: () => void;
}

/**
 * Confirmação curta ao disparar um flow manual (FX-031a; DS 3.0 F72-S07). Disparar tem
 * efeito imediato na conversa, então pede um clique a mais (UX §2.9) e mostra loading
 * (UX §2.7). Só leitura (F71-S17): "Disparar" fica `aria-disabled` com a explicação.
 */
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
      toast({ variant: 'error', title: 'Não foi possível disparar', description: message });
    }
  };

  return (
    <Modal
      open={!!flow}
      onClose={onClose}
      title="Disparar flow"
      className="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={trigger.isPending}>
            Cancelar
          </Button>
          <ReadOnlyGuard>
            <Button variant="primary" loading={trigger.isPending} onClick={() => void handleConfirm()}>
              Disparar
            </Button>
          </ReadOnlyGuard>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-text-mid">
        Disparar <span className="font-medium text-text">{flow?.name}</span> nesta conversa? As
        ações do flow começam agora.
      </p>
    </Modal>
  );
}
