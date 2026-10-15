'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightLeft, Check, Lock } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { moveOptions, nextMenuIndex } from './stageMove';
import type { Deal, Stage } from './types';

export interface StageMoveMenuProps {
  deal: Deal;
  stages: readonly Stage[];
  onMove: (toStageId: string) => void;
  className?: string;
}

const MENU_WIDTH = 224;
const GAP = 4;

/**
 * Menu "Mover para etapa" do card do kanban: a alternativa de um clique/teclado ao arrastar
 * (WCAG 2.5.7). Padrão WAI-ARIA "menu button": ↓/↑/Home/End andam pelos itens (pulando os
 * desabilitados), Enter/Espaço escolhem, Esc fecha e devolve o foco ao botão.
 *
 * O menu vai para um portal com posição fixa: a coluna do kanban tem rolagem própria e
 * cortaria um popover absoluto no último card.
 */
export function StageMoveMenu({ deal, stages, onMove, className }: StageMoveMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  // Item que recebe o foco ao abrir (WAI-ARIA menu button): ↓/Enter/clique → primeiro
  // destino válido; ↑ → último.
  const focusEdge = useRef<'first' | 'last'>('first');
  const options = moveOptions(stages, deal);
  const enabled = options.map((o) => !o.current && !o.blocked);

  const close = useCallback((returnFocus: boolean): void => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Posição: abaixo do botão, alinhado à direita; vira para cima se faltar espaço.
  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const t = triggerRef.current?.getBoundingClientRect();
      if (!t) return;
      const height = menuRef.current?.offsetHeight ?? 0;
      const below = t.bottom + GAP;
      const top = below + height > window.innerHeight - 8 ? Math.max(8, t.top - GAP - height) : below;
      const left = Math.min(Math.max(8, t.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
      setPos({ top, left });
    };
    place();
    // Rolar o board/coluna desloca o gatilho: fecha em vez de flutuar solto.
    const onScroll = (e: Event): void => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Foco no primeiro (ou, aberto por ↑, no último) destino válido ao abrir — só na
  // abertura, não a cada render.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const placed = pos !== null;
  useEffect(() => {
    if (!open || !placed) return;
    const edge = nextMenuIndex(enabledRef.current, -1, focusEdge.current === 'last' ? 'End' : 'Home');
    if (edge !== null) itemRefs.current[edge]?.focus();
    else menuRef.current?.focus();
  }, [open, placed]);

  // Clique fora fecha (sem roubar o foco de quem foi clicado).
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      // Menu não prende Tab: fecha e segue a ordem natural.
      setOpen(false);
      return;
    }
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const next = nextMenuIndex(enabled, current, e.key);
    if (next !== null) {
      e.preventDefault();
      itemRefs.current[next]?.focus();
    }
  }

  const menu =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={`Mover "${deal.title}" para a etapa`}
            tabIndex={-1}
            onKeyDown={onMenuKeyDown}
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width: MENU_WIDTH, visibility: pos ? 'visible' : 'hidden' }}
            className="fixed z-50 flex flex-col overflow-hidden rounded-md border border-border-2 bg-surface-2 p-1 shadow-ds-3 outline-none motion-safe:animate-[hm-fade-in_120ms_var(--ease)]"
          >
            <p
              aria-hidden
              className="px-2.5 pb-1 pt-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-text-low"
            >
              Mover para
            </p>
            {options.map((o, i) => (
              <button
                key={o.stage.id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={o.current || o.blocked || undefined}
                onClick={() => {
                  if (o.current || o.blocked) return;
                  close(false);
                  onMove(o.stage.id);
                }}
                className={cn(
                  'flex min-h-9 w-full items-center gap-2.5 rounded-sm px-2.5 text-left font-body text-sm outline-none',
                  'transition-colors duration-(--dur-fast) ease-ds motion-reduce:transition-none',
                  o.current || o.blocked
                    ? 'cursor-default text-text-low'
                    : 'text-text hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:focus-ring focus-visible:-outline-offset-2',
                )}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-pill"
                  style={{ backgroundColor: o.stage.color }}
                />
                <span className="min-w-0 flex-1 truncate">{o.stage.name}</span>
                {o.current ? (
                  <span className="inline-flex items-center gap-1 font-mono text-xs">
                    <Check className="size-3.5" aria-hidden /> Atual
                  </span>
                ) : o.blocked ? (
                  <span className="inline-flex items-center gap-1 font-mono text-xs">
                    <Lock className="size-3.5" aria-hidden /> Bloqueada
                  </span>
                ) : null}
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Mover "${deal.title}" para outra etapa`}
        title="Mover para etapa (Shift + ← →)"
        onClick={() => {
          focusEdge.current = 'first';
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            focusEdge.current = e.key === 'ArrowUp' ? 'last' : 'first';
            setOpen(true);
          }
        }}
        className={cn(
          'grid size-7 place-items-center rounded-sm pointer-coarse:size-11 border border-transparent bg-surface text-text-low outline-none',
          'transition-[color,border-color,opacity] duration-(--dur-fast) ease-ds motion-reduce:transition-none',
          'hover:border-border hover:text-text focus-visible:focus-ring aria-expanded:border-border aria-expanded:text-text',
          className,
        )}
      >
        <ArrowRightLeft className="size-3.5" aria-hidden />
      </button>
      {menu}
    </>
  );
}
