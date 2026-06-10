'use client';

import { useState } from 'react';
import { Target } from 'lucide-react';
import { Button } from '@hm/ui';
import { MarkConversionModal } from './MarkConversionModal';

export interface MarkConversionButtonProps {
  contactId: string;
  conversationId?: string | null;
  dealId?: string | null;
  variant?: 'primary' | 'secondary' | 'ghost';
}

/**
 * Botão "Marcar conversão" (F5-S13), autocontido — montável no ChatHeader,
 * DealDetailDrawer e ContatoPanel (gap-fill do orchestrator). Abre o modal.
 */
export function MarkConversionButton({
  contactId,
  conversationId,
  dealId,
  variant = 'secondary',
}: MarkConversionButtonProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Target className="size-4" />
        Marcar conversão
      </Button>
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
