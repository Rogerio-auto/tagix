'use client';

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
  /** largura do painel (default 420px). */
  widthClass?: string;
}

/** Drawer lateral (direita). Base para HelpPanel e, no futuro, detalhe de item
 *  (UX §2.3 — drawer no lugar de modal full-screen). Mantido montado para a
 *  transição; alterna pointer-events conforme `open`. */
export function Sheet({ open, onClose, title, children, widthClass = 'w-[420px]' }: SheetProps) {
  // Portal só após montar: servidor e 1º render do cliente devolvem null (iguais),
  // evitando hydration mismatch; o portal entra depois no client.
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Foco entra no painel ao abrir e volta ao gatilho ao fechar (WCAG 2.4.3, §2.10).
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  const trapTab = useCallback((e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab') return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div className={cn('fixed inset-0 z-50', open ? 'pointer-events-auto' : 'pointer-events-none')}>
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          'absolute inset-0 bg-black/50 transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />
      <aside
        ref={panelRef}
        role="complementary"
        aria-label={title}
        onKeyDown={trapTab}
        className={cn(
          'absolute inset-y-0 right-0 flex max-w-full flex-col border-l border-border bg-surface shadow-elev-4 transition-transform duration-200',
          widthClass,
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-border-2 px-5 py-4">
          <h2 className="font-head text-lg font-semibold text-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-sm p-1 text-text-low outline-none hover:text-text focus-visible:shadow-glow-md"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
