'use client';

/**
 * Painel de detalhe responsivo do catálogo (F47-S05; DS 3.0 na F72-S07).
 *
 * UX §2.3 / MOBILE_UX §2.3: detalhe abre no `Drawer` canônico do `@hm/ui` (desktop,
 * lateral, lista por trás continua visível; focus-trap, Esc, backdrop e retorno de
 * foco) e vira bottom-sheet no mobile (`@/shared/components/Sheet`, com swipe-down).
 * Nunca modal-cobre-tudo. Fechado, o Drawer desmonta ao fim da transição de saída,
 * então nada fica na árvore de acessibilidade (F70-S32).
 */
import type { ReactNode } from 'react';
import { Drawer } from '@hm/ui';
import { Sheet } from '@/shared/components/Sheet/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';

export interface ResponsivePanelProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Linha de apoio sob o título (desktop). */
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export function ResponsivePanel(props: ResponsivePanelProps): ReactNode {
  const { isMobile } = useBreakpoint();
  if (isMobile) {
    return (
      <Sheet open={props.open} onClose={props.onClose} title={props.title} footer={props.footer}>
        {props.children}
      </Sheet>
    );
  }
  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      title={props.title}
      description={props.description}
      footer={props.footer}
      className="max-w-120"
    >
      {props.children}
    </Drawer>
  );
}
