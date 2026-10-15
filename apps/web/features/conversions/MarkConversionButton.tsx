'use client';

import { useState } from 'react';
import { Target } from 'lucide-react';
import { Button, type ButtonSize } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { MarkConversionModal } from './MarkConversionModal';

export interface MarkConversionButtonProps {
  contactId: string;
  conversationId?: string | null;
  dealId?: string | null;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: ButtonSize;
}

/**
 * Botão "Marcar conversão" (F5-S13), autocontido — montável no ChatHeader,
 * DealDetailDrawer e ContatoPanel (gap-fill do orchestrator). Abre o modal.
 * Escrita: em empresa só leitura fica `aria-disabled` com a explicação (F72-S07).
 */
export function MarkConversionButton({
  contactId,
  conversationId,
  dealId,
  variant = 'secondary',
  size = 'md',
}: MarkConversionButtonProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ReadOnlyGuard>
        <Button
          variant={variant}
          size={size}
          leftIcon={<Target className="size-4" aria-hidden />}
          onClick={() => setOpen(true)}
        >
          Marcar conversão
        </Button>
      </ReadOnlyGuard>
      <MarkConversionModal
        open={open}
        onClose={() => setOpen(false)}
        contactId={contactId}
        conversationId={conversationId}
        dealId={dealId}
      />
    </>
  );
}
