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
  /** Rótulo visível curto no topo do diálogo (desktop). Padrão: o próprio `ariaLabel`. */
  eyebrow?: string;
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
 *
 * DS 3.0 (F72-S07): no desktop o título do diálogo é o rótulo de contexto em mono
 * ("Configuração inicial") — o nome acessível do diálogo é o `ariaLabel` completo.
 */
export function WizardShell({ open, onClose, ariaLabel, eyebrow, header, children, footer }: WizardShellProps): ReactNode {
  const { isMobile } = useBreakpoint();

  if (isMobile) {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        variant="full"
        ariaLabel={ariaLabel}
        hideCloseButton
        // Mesmo arranjo do rodapé do desktop: dica/voltar à esquerda, ação à direita.
        footer={footer ? <div className="flex w-full items-center justify-between gap-3">{footer}</div> : undefined}
      >
        <div className="flex flex-col gap-6 pt-2">
          {header}
          {children}
        </div>
      </Sheet>
    );
  }

  // Rótulo visível curto (decorativo) + o nome completo em `sr-only`: o nome acessível do
  // diálogo (aria-labelledby → título) é exatamente o `ariaLabel`.
  const title = (
    <>
      <span aria-hidden className="block font-mono text-xs font-medium uppercase tracking-widest text-text-low">
        {eyebrow ?? ariaLabel}
      </span>
      <span className="sr-only">{ariaLabel}</span>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={title} className="max-w-2xl">
      <div className="flex flex-col gap-6">
        {header}
        <div className="max-h-[60vh] overflow-y-auto pr-1">{children}</div>
        {footer && <div className="flex items-center justify-between gap-3 border-t border-border pt-4">{footer}</div>}
      </div>
    </Modal>
  );
}
