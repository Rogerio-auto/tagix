'use client';

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { TourPlacement, TourStep } from './types';

/** Respiro (px) entre o recorte e o elemento destacado. */
const SPOTLIGHT_PADDING = 8;
/** Distância (px) entre o balão e o recorte. */
const POPOVER_GAP = 12;
/** Margem (px) mínima das bordas da viewport. */
const VIEWPORT_MARGIN = 16;
/** Largura nominal do balão (px) — casa com `max-w` do painel. */
const POPOVER_WIDTH = 320;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TourSpotlightProps {
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onFinish: () => void;
  /** Resolve o elemento-alvo no momento da medição (pode ter mudado de layout). */
  resolveTarget: () => HTMLElement | null;
}

/** Mede o alvo em coordenadas de viewport. `null` = passo sem âncora (centralizado). */
function measure(el: HTMLElement | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top - SPOTLIGHT_PADDING,
    left: r.left - SPOTLIGHT_PADDING,
    width: r.width + SPOTLIGHT_PADDING * 2,
    height: r.height + SPOTLIGHT_PADDING * 2,
  };
}

/**
 * Calcula a posição do balão a partir do recorte e do lado preferido, com
 * fallback para o lado oposto quando não cabe e clamp nas margens da viewport.
 */
function positionPopover(
  hole: Rect | null,
  preferred: TourPlacement,
  vw: number,
  vh: number,
  popH: number,
): { top: number; left: number; placement: TourPlacement | 'center' } {
  // Sem âncora → balão centralizado na viewport.
  if (!hole) {
    return {
      top: Math.max(VIEWPORT_MARGIN, vh / 2 - popH / 2),
      left: Math.max(VIEWPORT_MARGIN, vw / 2 - POPOVER_WIDTH / 2),
      placement: 'center',
    };
  }

  const fitsBelow = hole.top + hole.height + POPOVER_GAP + popH + VIEWPORT_MARGIN <= vh;
  const fitsAbove = hole.top - POPOVER_GAP - popH - VIEWPORT_MARGIN >= 0;
  const fitsRight = hole.left + hole.width + POPOVER_GAP + POPOVER_WIDTH + VIEWPORT_MARGIN <= vw;
  const fitsLeft = hole.left - POPOVER_GAP - POPOVER_WIDTH - VIEWPORT_MARGIN >= 0;

  let placement: TourPlacement = preferred;
  if (preferred === 'bottom' && !fitsBelow && fitsAbove) placement = 'top';
  else if (preferred === 'top' && !fitsAbove && fitsBelow) placement = 'bottom';
  else if (preferred === 'right' && !fitsRight && fitsLeft) placement = 'left';
  else if (preferred === 'left' && !fitsLeft && fitsRight) placement = 'right';

  let top: number;
  let left: number;
  switch (placement) {
    case 'top':
      top = hole.top - POPOVER_GAP - popH;
      left = hole.left + hole.width / 2 - POPOVER_WIDTH / 2;
      break;
    case 'left':
      top = hole.top + hole.height / 2 - popH / 2;
      left = hole.left - POPOVER_GAP - POPOVER_WIDTH;
      break;
    case 'right':
      top = hole.top + hole.height / 2 - popH / 2;
      left = hole.left + hole.width + POPOVER_GAP;
      break;
    case 'bottom':
    default:
      top = hole.top + hole.height + POPOVER_GAP;
      left = hole.left + hole.width / 2 - POPOVER_WIDTH / 2;
      break;
  }

  // Clamp nas margens da viewport.
  left = Math.min(Math.max(VIEWPORT_MARGIN, left), vw - POPOVER_WIDTH - VIEWPORT_MARGIN);
  top = Math.min(Math.max(VIEWPORT_MARGIN, top), vh - popH - VIEWPORT_MARGIN);
  return { top, left, placement };
}

/**
 * Overlay de spotlight + balão (coachmark) do tour guiado (ONBOARDING.md §4.1).
 *
 * - Recorte do alvo via 4 retângulos de scrim (não usa `box-shadow` gigante, que
 *   borra; e mantém o alvo clicável por baixo do furo).
 * - Reposiciona em scroll/resize (rAF-coalesced) e quando o layout do alvo muda.
 * - Foco gerenciado: foca o balão ao abrir; `Esc` pula; setas/Enter/Tab navegam;
 *   `role="dialog"` + `aria-live` para leitores de tela.
 * - `motion-safe` < 250ms; respeita `prefers-reduced-motion` (classes `motion-safe:*`).
 *
 * Portal no `document.body`. SSR-safe (1º render no cliente devolve null até montar).
 */
export function TourSpotlight({
  step,
  stepIndex,
  totalSteps,
  onNext,
  onPrev,
  onSkip,
  onFinish,
  resolveTarget,
}: TourSpotlightProps): ReactNode {
  const [mounted, setMounted] = useState(false);
  const [hole, setHole] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; placement: TourPlacement | 'center' }>(
    { top: VIEWPORT_MARGIN, left: VIEWPORT_MARGIN, placement: 'center' },
  );

  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const rafRef = useRef<number | null>(null);

  const isLast = stepIndex >= totalSteps - 1;
  const isFirst = stepIndex <= 0;

  useEffect(() => setMounted(true), []);

  /** Mede alvo + recalcula posição do balão (coalescido por rAF). */
  const recompute = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const rect = measure(resolveTarget());
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const popH = panelRef.current?.offsetHeight ?? 180;
      setHole(rect);
      setPos(positionPopover(rect, step.placement ?? 'bottom', vw, vh, popH));
    });
  }, [resolveTarget, step.placement]);

  // Recalcula no mount/troca de passo e em scroll/resize. useLayoutEffect evita
  // flash de posição errada antes da pintura.
  useLayoutEffect(() => {
    recompute();
    const onChange = () => recompute();
    window.addEventListener('scroll', onChange, true);
    window.addEventListener('resize', onChange);
    return () => {
      window.removeEventListener('scroll', onChange, true);
      window.removeEventListener('resize', onChange);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [recompute, stepIndex]);

  // Traz o alvo para a viewport e foca o balão ao abrir/trocar de passo.
  useEffect(() => {
    const el = resolveTarget();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    // Devolve o foco ao gatilho ao desmontar (WCAG 2.4.3).
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      previouslyFocused?.focus?.();
    };
    // Re-foca a cada passo (stepIndex) e quando o resolvedor muda (troca de alvo).
  }, [stepIndex, resolveTarget]);

  // Teclado global: Esc pula; setas navegam. (Tab é tratado pelo trap no painel.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onSkip();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (!isFirst) onPrev();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onSkip, onNext, onPrev, isFirst]);

  // Focus-trap dentro do balão (Tab cicla nos controles do balão).
  const trapTab = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
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
    <div
      className="fixed inset-0 z-[60] motion-safe:animate-[hm-fade-in_200ms_ease-out]"
      role="presentation"
    >
      {/* Scrim recortado: 4 faixas que circundam o furo do alvo (mantém o alvo
          clicável e visível). Sem âncora → scrim cobre tudo. */}
      <Scrim hole={hole} onClick={onSkip} />

      {/* Anel de destaque do alvo (cosmético; não intercepta ponteiro). */}
      {hole && (
        <div
          aria-hidden
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
          className={cn(
            'pointer-events-none absolute rounded-md',
            'ring-2 ring-brand shadow-glow-md',
            'motion-safe:transition-[top,left,width,height] motion-safe:duration-200 motion-safe:ease-out',
          )}
        />
      )}

      {/* Balão (popover) */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onKeyDown={trapTab}
        style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
        className={cn(
          'absolute z-10 flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-text shadow-elev-4 outline-none',
          'motion-safe:transition-[top,left] motion-safe:duration-200 motion-safe:ease-out',
          'motion-safe:animate-[hm-modal-in_200ms_ease-out]',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-head text-base font-semibold text-text">
            {step.title}
          </h2>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Encerrar tour"
            className="-mr-1 -mt-1 grid size-7 place-items-center rounded-sm text-text-low outline-none transition-colors duration-150 hover:text-text focus-visible:shadow-glow-md"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {/* aria-live para anunciar o conteúdo do passo aos leitores de tela. */}
        <p id={bodyId} aria-live="polite" className="font-body text-sm leading-relaxed text-text-mid">
          {step.body}
        </p>

        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="font-body text-xs tabular-nums text-text-low" aria-hidden>
            {stepIndex + 1} / {totalSteps}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSkip}
              className="rounded-md px-2 py-1.5 font-head text-xs font-semibold text-text-low outline-none transition-colors duration-150 hover:text-text focus-visible:shadow-glow-md"
            >
              Pular
            </button>
            {!isFirst && (
              <button
                type="button"
                onClick={onPrev}
                className="rounded-md border border-border bg-transparent px-3 py-1.5 font-head text-xs font-semibold text-text outline-none transition-colors duration-150 hover:border-border-2 hover:bg-surface-2 focus-visible:shadow-glow-md"
              >
                Anterior
              </button>
            )}
            <button
              type="button"
              onClick={isLast ? onFinish : onNext}
              className="rounded-md bg-brand px-3 py-1.5 font-head text-xs font-semibold text-text-on-brand outline-none transition-colors duration-150 hover:bg-brand-strong focus-visible:shadow-glow-md"
            >
              {isLast ? 'Concluir' : 'Próximo'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Scrim recortado: renderiza 4 retângulos (topo/baixo/esquerda/direita) que
 * circundam o furo do alvo, escurecendo o resto da tela sem cobrir o alvo. Cada
 * faixa fecha o tour ao clique (descartar tocando fora — como backdrop). Sem furo,
 * cobre a tela inteira.
 */
function Scrim({ hole, onClick }: { hole: Rect | null; onClick: () => void }): ReactNode {
  const scrimClass = 'absolute bg-black/55 motion-safe:transition-all motion-safe:duration-200';
  if (!hole) {
    return <div aria-hidden onClick={onClick} className={cn('inset-0', scrimClass)} />;
  }
  const right = hole.left + hole.width;
  const bottom = hole.top + hole.height;
  return (
    <>
      {/* topo */}
      <div
        aria-hidden
        onClick={onClick}
        style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }}
        className={scrimClass}
      />
      {/* baixo */}
      <div
        aria-hidden
        onClick={onClick}
        style={{ top: bottom, left: 0, right: 0, bottom: 0 }}
        className={scrimClass}
      />
      {/* esquerda */}
      <div
        aria-hidden
        onClick={onClick}
        style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }}
        className={scrimClass}
      />
      {/* direita */}
      <div
        aria-hidden
        onClick={onClick}
        style={{ top: hole.top, left: right, right: 0, height: hole.height }}
        className={scrimClass}
      />
    </>
  );
}
