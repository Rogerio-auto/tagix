'use client';

import { Button, Modal } from '@hm/ui';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  /** `danger` para ações destrutivas/irreversíveis (UX §2.9). */
  tone?: 'primary' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Confirmação proporcional ao risco (UX §2.9). Modal reservado a confirmação. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant={tone} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
