'use client';

import type { ReactNode } from 'react';
import { Modal } from '@hm/ui';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';

export interface WizardShellProps {
  open: boolean;
  onClose: () => void;
  /** Rótulo de acessibilidade do diálogo. */
  ariaLabel: string;
  /** Header fixo (boas-vindas/stepper). */
  header?: ReactNode;
  /** Corpo rolável do passo atual. */
  children: ReactNode;
  /** Rodapé fixo com as ações (voltar / avançar / aplicar). */
  footer?: ReactNode;
}

/**
 * Casca responsiva do wizard de onboarding (MOBILE_UX §2.3): em `md+` é um Modal
 * centrado (wizard é um dos usos legítimos de Modal por UX §2.3); em `< md` vira
 * um bottom-Sheet com rodapé fixo na zona do polegar. O conteúdo dos passos é o
 * mesmo nos dois — só a moldura muda. Sem `onClose` em pontos onde abandonar
 * perderia trabalho: o controle de fechamento fica nos botões internos.
 */
export function WizardShell({ open, onClose, ariaLabel, header, children, footer }: WizardShellProps): ReactNode {
  const { isMobile } = useBreakpoint();

  if (isMobile) {
    return (
      <Sheet open={open} onClose={onClose} variant="full" ariaLabel={ariaLabel} hideCloseButton footer={footer}>
        <div className="flex flex-col gap-6 pt-2">
          {header}
          {children}
        </div>
      </Sheet>
    );
  }

  return (
    <Modal open={open} onClose={onClose} className="max-w-2xl">
      <div className="flex flex-col gap-6" role="group" aria-label={ariaLabel}>
        {header}
        <div className="max-h-[60vh] overflow-y-auto pr-1">{children}</div>
        {footer && <div className="flex items-center justify-between gap-3 border-t border-border-2 pt-4">{footer}</div>}
      </div>
    </Modal>
  );
}
