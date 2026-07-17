import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import { IconButton } from '../IconButton/IconButton';

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Duração da transição de entrada/saída (ms). Deve casar com `duration-200`. */
const TRANSITION_MS = 200;

export type DrawerSide = 'right' | 'bottom';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /**
   * Origem do painel. `right` (default) é o detalhe de item lateral e colapsa
   * para bottom-sheet no mobile; `bottom` é bottom-sheet em qualquer largura.
   */
  side?: DrawerSide;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Classe extra do painel (ex.: `max-w-lg` para alargar). */
  className?: string;
  /** Exibe o botão de fechar no cabeçalho (default `true`). */
  showClose?: boolean;
  /** Fechar ao clicar no backdrop (default `true`). Esc sempre fecha (a11y). */
  dismissible?: boolean;
  /** Rótulo do diálogo quando não há `title` visível. */
  ariaLabel?: string;
}

const panelBySide: Record<DrawerSide, string> = {
  right: cn(
    'inset-y-0 right-0 h-dvh w-full max-w-md border-l border-border',
    // Colapsa para bottom-sheet no mobile.
    'max-sm:inset-x-0 max-sm:inset-y-auto max-sm:bottom-0 max-sm:h-auto max-sm:max-h-[85dvh]',
    'max-sm:max-w-none max-sm:rounded-t-2xl max-sm:border-l-0 max-sm:border-t',
  ),
  bottom: 'inset-x-0 bottom-0 max-h-[85dvh] w-full rounded-t-2xl border-t border-border',
};

const hiddenBySide: Record<DrawerSide, string> = {
  right: 'translate-x-full max-sm:translate-x-0 max-sm:translate-y-full',
  bottom: 'translate-y-full',
};

const visibleBySide: Record<DrawerSide, string> = {
  right: 'translate-x-0 max-sm:translate-y-0',
  bottom: 'translate-y-0',
};

/**
 * Drawer canônico do DS v2 (UX §2.3): overlay lateral acessível para DETALHE de
 * item — não use Modal full-screen para isso. Focus-trap único, Esc/backdrop,
 * scroll-lock, retorno de foco ao gatilho e bottom-sheet responsivo no mobile.
 *
 * Substitui os drawers hand-rolled (`Sheet.tsx` homônimos, backdrops montados à
 * mão sem focus-trap) apontados na auditoria §3.9.
 */
export function Drawer({
  open,
  onClose,
  side = 'right',
  title,
  description,
  children,
  footer,
  className,
  showClose = true,
  dismissible = true,
  ariaLabel,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  // `rendered` mantém o portal montado durante a transição de saída;
  // `visible` dispara a transição (entra no frame seguinte ao mount).
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setRendered(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const timer = setTimeout(() => setRendered(false), TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [open]);

  // Esc, scroll-lock e gestão de foco só enquanto aberto e montado.
  useEffect(() => {
    if (!open || !rendered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Guarda o gatilho para devolver o foco ao fechar (WCAG 2.4.3).
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, rendered, onClose]);

  const trapTab = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
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

  if (!rendered || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50" role="presentation">
      <div
        aria-hidden
        onMouseDown={dismissible ? onClose : undefined}
        className={cn(
          'absolute inset-0 bg-black/60 transition-opacity duration-200 ease-out',
          'motion-reduce:transition-none',
          visible ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : (ariaLabel ?? 'Painel')}
        aria-describedby={description ? descId : undefined}
        onKeyDown={trapTab}
        className={cn(
          'absolute z-10 flex flex-col bg-surface shadow-elev-4',
          'transition-transform duration-200 ease-out motion-reduce:transition-none',
          panelBySide[side],
          visible ? visibleBySide[side] : hiddenBySide[side],
          className,
        )}
      >
        {(title || description || showClose) && (
          <div className="flex items-start justify-between gap-4 border-b border-border-2 px-5 py-4">
            <div className="min-w-0 flex-1">
              {title && (
                <h2 id={titleId} className="truncate font-head text-lg font-semibold text-text">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className="mt-1 font-body text-sm text-text-mid">
                  {description}
                </p>
              )}
            </div>
            {showClose && (
              <IconButton
                aria-label="Fechar"
                icon={<X />}
                size="sm"
                onClick={onClose}
                className="-mr-1 shrink-0"
              />
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4 font-body text-text">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border-2 px-5 py-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
