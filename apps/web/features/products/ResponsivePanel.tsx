'use client';

/**
 * Painel de detalhe responsivo do catálogo (F47-S05).
 *
 * UX §2.3 / MOBILE_UX §2.3: detalhe abre em **drawer lateral** (desktop, ~480px,
 * desliza da direita, lista por trás continua visível) e vira **bottom-sheet** no
 * mobile (componente `@/shared/components/Sheet`, com swipe-down/handle/focus-trap).
 * Nunca modal-cobre-tudo. Fecha por `Esc`, backdrop e botão X — três caminhos.
 */
import type { ReactNode } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Sheet } from '@/shared/components/Sheet/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { cn } from '@/shared/lib/cn';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ResponsivePanelProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/** Drawer lateral do desktop (mobile usa o Sheet). Portal + focus-trap + Esc. */
function DesktopDrawer({ open, onClose, title, children, footer }: ResponsivePanelProps): ReactNode {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  const trapTab = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) {
      e.preventDefault();
      return;
    }
    const firstEl = nodes[0];
    const lastEl = nodes[nodes.length - 1];
    if (!firstEl || !lastEl) return;
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-end',
        open ? 'pointer-events-auto' : 'pointer-events-none',
      )}
    >
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          'absolute inset-0 bg-black/60 motion-safe:transition-opacity motion-safe:duration-200',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={cn(
          'relative flex h-dvh w-full max-w-[480px] flex-col border-l border-border bg-surface text-text shadow-elev-4 outline-none',
          'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border-2 px-6 py-4">
          <h2 id={titleId} className="font-head text-lg font-semibold text-text">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="touch-target -mr-2 grid place-items-center rounded-sm text-text-low outline-none transition-colors duration-150 hover:text-text focus-visible:shadow-glow-md"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="border-t border-border-2 px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
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
  return <DesktopDrawer {...props} />;
}
