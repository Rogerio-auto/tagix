import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Modal acessível (portal + backdrop + focus trap + Esc/click-out).
 * UX §2.3: reservado a CONFIRMAÇÃO e WIZARD — detalhe de item usa Drawer, não Modal.
 */
export function Modal({ open, onClose, title, description, children, footer, className }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Guarda o gatilho para devolver o foco ao fechar (WCAG 2.4.3 — ordem de foco).
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  const trapTab = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
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

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/60 motion-safe:animate-[hm-fade-in_180ms_ease-out]" aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Diálogo'}
        aria-describedby={description ? descId : undefined}
        onKeyDown={trapTab}
        className={cn(
          'relative z-10 w-full max-w-md rounded-lg border border-border bg-surface shadow-elev-4',
          'motion-safe:animate-[hm-modal-in_200ms_ease-out]',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          {title && (
            <h2 id={titleId} className="font-head text-xl font-semibold text-text">
              {title}
            </h2>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="ml-auto rounded-sm p-1 text-text-low outline-none transition-colors duration-200 hover:text-text focus-visible:shadow-glow-md"
          >
            <X className="size-5" />
          </button>
        </div>
        {description && (
          <p id={descId} className="px-5 pt-2 font-body text-sm text-text-mid">
            {description}
          </p>
        )}
        <div className="px-5 py-4 font-body text-text">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border-2 px-5 py-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
