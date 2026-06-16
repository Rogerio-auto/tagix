'use client';

import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Distância (px) de arraste para baixo que confirma o fechamento por swipe. */
const DISMISS_THRESHOLD = 96;
/** Velocidade (px/ms) de flick para baixo que confirma o fechamento mesmo curto. */
const DISMISS_VELOCITY = 0.5;

export type SheetVariant = 'bottom' | 'full';

export interface SheetProps {
  /** Visível quando `true`. Mantido montado durante a transição de saída. */
  open: boolean;
  /** Chamado por backdrop, `Esc`, botão X e swipe-down. */
  onClose: () => void;
  /**
   * `bottom` (default): bottom-sheet ancorado embaixo, altura por conteúdo até
   * ~90dvh, cantos arredondados no topo, handle de arraste.
   * `full`: ocupa a tela (com safe-area), para inspectors/detalhe denso.
   */
  variant?: SheetVariant;
  /** Título no header. Vira o `aria-label` do dialog quando presente. */
  title?: ReactNode;
  /** Rótulo de acessibilidade quando não há `title` textual. */
  ariaLabel?: string;
  /** Conteúdo rolável do corpo. */
  children?: ReactNode;
  /** Conteúdo fixo no rodapé (ex.: CTA primário na zona do polegar). */
  footer?: ReactNode;
  /** Esconde o botão X do header (o swipe/backdrop/Esc continuam fechando). */
  hideCloseButton?: boolean;
  /** Classe extra no painel. */
  className?: string;
}

/**
 * Bottom/full-sheet mobile (UX §2.3 — o drawer lateral do desktop vira sheet no
 * mobile; mantém contexto, não é modal-cobre-tudo). Fecha por swipe-down, backdrop
 * e `Esc`; handle de arraste; focus-trap + `role="dialog"` + `aria-modal`;
 * restaura o foco ao gatilho ao fechar; animação `motion-safe` < 250ms.
 *
 * SSR-safe: o portal só monta no cliente (server e 1º render devolvem `null`,
 * iguais), evitando hydration mismatch.
 *
 * NÃO mora em `@hm/ui` de propósito (gotcha do barrel client→server leak, F10).
 */
export function Sheet({
  open,
  onClose,
  variant = 'bottom',
  title,
  ariaLabel,
  children,
  footer,
  hideCloseButton = false,
  className,
}: SheetProps): ReactNode {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Deslocamento de arraste corrente (px, >= 0). Resetado ao abrir/fechar.
  const [dragY, setDragY] = useState(0);
  const dragState = useRef<{ startY: number; startT: number; active: boolean }>({
    startY: 0,
    startT: 0,
    active: false,
  });

  useEffect(() => setMounted(true), []);

  // Trava o scroll do body enquanto aberto (evita scroll-chaining no mobile).
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  // Esc fecha; foco entra no painel ao abrir e volta ao gatilho ao fechar.
  useEffect(() => {
    if (!open) return;
    setDragY(0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Foca o primeiro interativo, ou o próprio painel (tabindex -1) como fallback.
    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (firstFocusable ?? panel)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  const trapTab = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) {
      e.preventDefault();
      return;
    }
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

  // ── Swipe-down para fechar (somente na drag handle, descobrível e seguro) ──
  const onHandlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { startY: e.clientY, startT: performance.now(), active: true };
  }, []);

  const onHandlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState.current.active) return;
    const delta = e.clientY - dragState.current.startY;
    // Só permite arrastar para baixo; resistência leve para cima (clamp em 0).
    setDragY(delta > 0 ? delta : 0);
  }, []);

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragState.current.active) return;
      dragState.current.active = false;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      const delta = e.clientY - dragState.current.startY;
      const elapsed = performance.now() - dragState.current.startT;
      const velocity = elapsed > 0 ? delta / elapsed : 0;
      if (delta > DISMISS_THRESHOLD || velocity > DISMISS_VELOCITY) {
        onClose();
      } else {
        setDragY(0);
      }
    },
    [onClose],
  );

  if (!mounted) return null;

  const label = typeof title === 'string' ? undefined : ariaLabel;
  const isDragging = dragState.current.active;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex flex-col justify-end',
        open ? 'pointer-events-auto' : 'pointer-events-none',
      )}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          'absolute inset-0 bg-black/60 motion-safe:transition-opacity motion-safe:duration-200',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />

      {/* Painel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={typeof title === 'string' ? titleId : undefined}
        aria-label={label}
        tabIndex={-1}
        onKeyDown={trapTab}
        style={{ transform: open ? `translateY(${dragY}px)` : undefined }}
        className={cn(
          'relative flex w-full flex-col bg-surface text-text shadow-elev-4 outline-none',
          // Transição só quando não está sendo arrastado (arraste segue o dedo 1:1).
          !isDragging && 'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out',
          variant === 'bottom'
            ? 'max-h-[90dvh] rounded-t-lg border-t border-border pb-safe'
            : 'h-dvh rounded-none pt-safe pb-safe',
          open ? 'translate-y-0' : 'translate-y-full',
          className,
        )}
      >
        {/* Drag handle — afforda o arraste; também é alvo de swipe-down. */}
        {variant === 'bottom' && (
          <div
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            aria-hidden
            className="flex cursor-grab touch-none justify-center pt-3 pb-1 active:cursor-grabbing"
          >
            <span className="h-1.5 w-10 rounded-pill bg-border-2" />
          </div>
        )}

        {(title || !hideCloseButton) && (
          <div
            className={cn(
              'flex items-center justify-between gap-3 px-5',
              variant === 'bottom' ? 'pt-1 pb-3' : 'pt-3 pb-3',
            )}
          >
            {title ? (
              <h2 id={typeof title === 'string' ? titleId : undefined} className="font-head text-lg font-semibold text-text">
                {title}
              </h2>
            ) : (
              <span />
            )}
            {!hideCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar"
                className="touch-target -mr-2 grid place-items-center rounded-sm text-text-low outline-none transition-colors duration-150 hover:text-text focus-visible:shadow-glow-md"
              >
                <X className="size-5" />
              </button>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>

        {footer && <div className="border-t border-border-2 px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
