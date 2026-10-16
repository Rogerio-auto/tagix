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
    // Fechado, o painel segue montado só para a transição de saída: `inert` o tira do Tab
    // e dos cliques, `aria-hidden` da árvore de acessibilidade (F70-S32, mesmo bug do
    // `Sheet` corrigido na F70-S29).
    <div
      inert={!open}
      aria-hidden={open ? undefined : true}
      className={cn('fixed inset-0 z-50', open ? 'pointer-events-auto' : 'pointer-events-none')}
    >
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          'absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-(--dur-base) ease-ds motion-reduce:transition-none',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />
      <aside
        ref={panelRef}
        role="complementary"
        aria-label={title}
        onKeyDown={trapTab}
        className={cn(
          'absolute inset-y-0 right-0 flex max-w-full flex-col border-l border-border bg-surface shadow-ds-3 transition-transform duration-(--dur-base) ease-ds-spring motion-reduce:transition-none',
          widthClass,
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex min-w-0 flex-col gap-1">
            <p aria-hidden className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-text-low">
              Ajuda
            </p>
            <h2 className="font-head text-h4 text-text">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="-mr-1 grid size-9 shrink-0 place-items-center rounded-sm text-text-low outline-none transition-colors duration-(--dur-fast) ease-ds hover:bg-surface-2 hover:text-text focus-visible:focus-ring"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 pb-safe-4 font-body text-body text-text-mid">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
