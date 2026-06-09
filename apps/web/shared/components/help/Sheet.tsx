'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

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
        role="complementary"
        aria-label={title}
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
