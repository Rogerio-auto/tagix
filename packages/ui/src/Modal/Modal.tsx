import type { ReactNode, RefObject, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from '../IconButton/IconButton';
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
  /** Elemento que recebe o foco ao abrir (ex.: o botão seguro de um diálogo destrutivo). Padrão: 1º focável. */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Modal acessível (portal + backdrop + focus trap + Esc/click-out).
 * UX §2.3: reservado a CONFIRMAÇÃO e WIZARD — detalhe de item usa Drawer, não Modal.
 */
export function Modal({ open, onClose, title, description, children, footer, className, initialFocusRef }: ModalProps) {
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
    (initialFocusRef?.current ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose, initialFocusRef]);

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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm motion-safe:animate-[hm-fade-in_var(--dur-base)_var(--ease)_both]" aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Diálogo'}
        aria-describedby={description ? descId : undefined}
        onKeyDown={trapTab}
        className={cn(
          'relative z-10 w-full max-w-md rounded-xl border border-border bg-surface shadow-ds-3',
          'motion-safe:animate-[hm-modal-in_240ms_var(--ease-spring)_both]',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          {title && (
            <h2 id={titleId} className="font-head text-xl font-semibold text-text">
              {title}
            </h2>
          )}
          <IconButton aria-label="Fechar" icon={<X />} size="sm" onClick={onClose} className="-mr-1 -mt-1 ml-auto shrink-0" />
        </div>
        {description && (
          <p id={descId} className="px-5 pt-2 font-body text-sm text-text-mid">
            {description}
          </p>
        )}
        <div className="px-5 py-4 font-body text-text">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
