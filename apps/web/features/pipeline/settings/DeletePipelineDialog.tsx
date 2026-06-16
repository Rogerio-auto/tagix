'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Input, Modal } from '@hm/ui';

export interface DeletePipelineDialogProps {
  open: boolean;
  pipelineName: string;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting?: boolean;
}

/**
 * Dialogo de confirmacao de exclusao de pipeline (F35-S01).
 * Requer digitar o nome exato para habilitar o botao de deletar.
 */
export function DeletePipelineDialog({
  open,
  pipelineName,
  onClose,
  onConfirm,
  isDeleting = false,
}: DeletePipelineDialogProps) {
  const [confirmation, setConfirmation] = useState('');
  const isMatch = confirmation === pipelineName;

  function handleClose() {
    setConfirmation('');
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Excluir pipeline"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={isDeleting}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="delete-pipeline-form"
            disabled={!isMatch || isDeleting}
            className="bg-danger text-white hover:bg-danger/90 focus-visible:ring-danger"
          >
            {isDeleting ? 'Excluindo...' : 'Excluir pipeline'}
          </Button>
        </>
      }
    >
      <form
        id="delete-pipeline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (isMatch) onConfirm();
        }}
        className="flex flex-col gap-4"
      >
        <div className="flex items-start gap-3 rounded-md border border-danger/30 bg-danger/10 p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <p className="text-sm text-danger">
            Todos os deals e estagios serao excluidos permanentemente. Esta acao nao pode ser
            desfeita.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="delete-confirm" className="text-sm text-text-mid">
            Digite <strong className="font-semibold text-text">{pipelineName}</strong> para
            confirmar:
          </label>
          <Input
            id="delete-confirm"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={pipelineName}
            autoFocus
          />
        </div>
      </form>
    </Modal>
  );
}
