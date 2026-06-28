'use client';

/**
 * Menu de anexo do composer (F45-S05). Popover "+" ancorado (NÃO modal
 * full-screen — UX §3) que agrupa as modalidades estruturadas de envio:
 * sticker e localização hoje; contato entra no S07 só ACRESCENTANDO um item à
 * lista `options` — sem reescrever este componente nem o `MessageComposer`
 * (scaffold-then-fill, RICH_COMPOSER §4).
 *
 * O menu tem duas "vistas" na mesma superfície ancorada: a lista de opções e o
 * painel da opção escolhida (`option.render`). `Esc` recua do painel para a
 * lista (e da lista fecha); clique-fora/toggle fecham e devolvem o foco ao
 * composer via `onClosed`. Cada opção é ícone + label (UX §2 — ações nomeadas).
 *
 * DS v2: zero hex, só tokens; foco `focus-visible:shadow-glow-md`; alvo ≥44px.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, Plus } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { ComposerActionButton } from './ComposerActionBar';

/**
 * Modalidade declarativa do menu. `render(close)` desenha o painel da opção; o
 * `close` recebido fecha o menu inteiro (chamado após um envio bem-sucedido).
 */
export interface AttachmentOption {
  /** Identidade estável para a key da lista e a vista ativa. */
  readonly id: string;
  /** Ícone (`lucide`) à esquerda do item. */
  readonly icon: ReactNode;
  /** Rótulo da ação (vira o título do painel quando ativa). */
  readonly label: string;
  /** Descrição curta opcional sob o rótulo na lista. */
  readonly description?: string;
  /** Conteúdo do painel da modalidade; `close` fecha o menu (pós-envio). */
  readonly render: (close: () => void) => ReactNode;
}

export interface AttachmentMenuProps {
  /** Modalidades, de cima para baixo. Extensível (S07 acrescenta "Contato"). */
  readonly options: readonly AttachmentOption[];
  readonly disabled?: boolean;
  /** Chamado ao fechar (Esc/clique-fora/toggle) p/ devolver o foco ao composer. */
  readonly onClosed?: () => void;
}

export function AttachmentMenu({ options, disabled = false, onClosed }: AttachmentMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setActiveId(null);
    if (returnFocus) onClosed?.();
  };

  // Click-fora fecha e devolve o foco ao composer.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) close(true);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Foca o primeiro item ao abrir a lista (foco gerenciado no popover).
  useEffect(() => {
    if (open && activeId === null) {
      requestAnimationFrame(() => firstItemRef.current?.focus());
    }
  }, [open, activeId]);

  const active = activeId === null ? null : (options.find((o) => o.id === activeId) ?? null);

  return (
    <div ref={containerRef} className="relative">
      <ComposerActionButton
        ref={triggerRef}
        icon={<Plus className="size-5" aria-hidden />}
        label="Anexar"
        active={open}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => (open ? close(true) : setOpen(true))}
      />

      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={active ? active.label : 'Anexar'}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              if (active) setActiveId(null);
              else close(true);
            }
          }}
          className={cn(
            'absolute bottom-full left-0 z-30 mb-2 w-72 rounded-lg border border-border',
            'bg-surface-2 p-2 shadow-glow-md',
          )}
        >
          {active ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  aria-label="Voltar"
                  title="Voltar"
                  className={cn(
                    'flex size-8 items-center justify-center rounded-md text-text-mid outline-none',
                    'transition-colors hover:bg-surface-3 hover:text-text focus-visible:shadow-glow-md',
                  )}
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
                <h3 className="font-body text-sm font-medium text-text">{active.label}</h3>
              </div>
              {active.render(() => close(true))}
            </div>
          ) : (
            <ul role="menu" aria-label="Modalidades de anexo" className="flex flex-col gap-0.5">
              {options.map((option, index) => (
                <li key={option.id} role="none">
                  <button
                    ref={index === 0 ? firstItemRef : undefined}
                    role="menuitem"
                    type="button"
                    onClick={() => setActiveId(option.id)}
                    className={cn(
                      'touch-target flex w-full items-center gap-3 rounded-md px-2 text-left outline-none',
                      'transition-colors hover:bg-surface-3 focus-visible:shadow-glow-md',
                    )}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-inset text-text-mid">
                      {option.icon}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="font-body text-sm text-text">{option.label}</span>
                      {option.description !== undefined && (
                        <span className="font-body text-xs text-text-low">{option.description}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
