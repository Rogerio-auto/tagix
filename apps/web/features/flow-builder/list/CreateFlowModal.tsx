'use client';

import { useState } from 'react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { useCreateFlow } from './queries';
import type { FlowTriggerType } from './types';

const TRIGGER_OPTIONS: { value: FlowTriggerType; label: string }[] = [
  { value: 'manual', label: 'Manual (botao na conversa)' },
  { value: 'keyword', label: 'Palavra-chave na mensagem' },
  { value: 'new_message', label: 'Nova mensagem' },
  { value: 'new_lead', label: 'Novo contato' },
  { value: 'flow_submission', label: 'Resposta de formulario (Meta Flow)' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (flowId: string) => void;
}

/** Drawer/modal de criacao de um flow draft (F4-S09). Cria e direciona ao editor. */
export function CreateFlowModal({ open, onClose, onCreated }: Props) {
  const { toast } = useToast();
  const createFlow = useCreateFlow();

  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<FlowTriggerType>('manual');
  const [nameError, setNameError] = useState<string | undefined>();

  const reset = () => {
    setName('');
    setTriggerType('manual');
    setNameError(undefined);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleCreate = async () => {
    if (name.trim().length === 0) {
      setNameError('Informe um nome para o flow.');
      return;
    }
    try {
      const { flow } = await createFlow.mutateAsync({ name: name.trim(), triggerType });
      toast({ variant: 'success', title: 'Flow criado', description: flow.name });
      reset();
      onClose();
      onCreated?.(flow.id);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Tente novamente.';
      toast({ variant: 'error', title: 'Falha ao criar o flow', description: message });
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Novo flow" className="max-w-lg">
      <div className="flex flex-col gap-4">
        <Input
          label="Nome do flow *"
          value={name}
          error={nameError}
          placeholder="Ex.: Boas-vindas WhatsApp"
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(undefined);
          }}
        />

        <label className="flex flex-col gap-1.5">
          <span className="font-head text-sm font-medium text-text">Gatilho</span>
          <select
            className="rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value as FlowTriggerType)}
          >
            {TRIGGER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-1 flex items-center justify-end gap-2 border-t border-border-2 pt-4">
          <Button variant="ghost" onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleCreate()}
            disabled={createFlow.isPending}
          >
            {createFlow.isPending ? 'Criando...' : 'Criar flow'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
