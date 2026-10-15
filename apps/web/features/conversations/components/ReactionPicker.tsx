'use client';

/**
 * `ReactionPicker` — mini-picker de emojis ancorado a uma bolha (F45-S06).
 *
 * Linha de reações frequentes (👍❤️😂😮😢🙏) + botão "mais" que expande um grid
 * estendido. Sem dependência de lib de emoji — o conjunto frequente cobre o uso
 * comum e o estendido dá variedade sem peso. Fecha em Escape, clique fora
 * (backdrop) ou ao escolher. Alvos de toque ≥44px no mobile (UX — thumb-first).
 *
 * Apresentação pura: não conhece a rota; emite `onSelect(emoji)` e o
 * `MessageBubble`/`useReactions` cuidam do envio otimista (toggle/remoção).
 */

import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

/** Reações frequentes (ordem espelha o padrão dos apps de mensagem). */
const QUICK: readonly string[] = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Conjunto estendido (revelado por "mais") — variedade sem lib externa. */
const EXTENDED: readonly string[] = [
  '👍', '👎', '❤️', '🔥', '🎉', '👏',
  '😂', '😅', '🙂', '😮', '😢', '😡',
  '🙏', '💯', '✅', '👀', '🤝', '💪',
];

export interface ReactionPickerProps {
  /** Emoji atualmente aplicado pela pessoa (`''` se nenhum) — destacado no picker. */
  current: string;
  /** Escolha de um emoji (o chamador decide aplicar/trocar/remover). */
  onSelect: (emoji: string) => void;
  /** Fecha o picker (Escape / clique fora / após escolher). */
  onClose: () => void;
  /** Ancoragem horizontal: `end` (bolha à direita) ou `start` (à esquerda). */
  align: 'start' | 'end';
}

export function ReactionPicker({ current, onSelect, onClose, align }: ReactionPickerProps) {
  const [expanded, setExpanded] = useState(false);

  // Escape fecha (UX §2.10 — atalho de teclado; dismiss previsível).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function choose(emoji: string) {
    onSelect(emoji);
    onClose();
  }

  return (
    <>
      {/* Backdrop transparente: clique fora fecha (não rouba foco visual). */}
      <button
        type="button"
        aria-label="Fechar seletor de reações"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default"
      />

      <div
        role="menu"
        aria-label="Reagir com emoji"
        className={cn(
          'absolute bottom-full z-50 mb-2 w-max max-w-[min(20rem,80vw)] rounded-lg border border-border',
          'bg-surface-3 p-1.5 shadow-elev-4 motion-safe:transition-opacity',
          align === 'end' ? 'right-0' : 'left-0',
        )}
      >
        {expanded ? (
          <div className="grid grid-cols-6 gap-0.5">
            {EXTENDED.map((emoji, i) => (
              <EmojiButton
                key={`${emoji}-${i}`}
                emoji={emoji}
                active={emoji === current}
                onClick={() => choose(emoji)}
              />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-0.5">
            {QUICK.map((emoji) => (
              <EmojiButton
                key={emoji}
                emoji={emoji}
                active={emoji === current}
                onClick={() => choose(emoji)}
              />
            ))}
            <button
              type="button"
              aria-label="Mais reações"
              onClick={() => setExpanded(true)}
              className={cn(
                'grid size-11 shrink-0 place-items-center rounded-md text-text-mid outline-none sm:size-9',
                'motion-safe:transition-colors hover:bg-surface-2 hover:text-text',
                'focus-visible:focus-ring',
              )}
            >
              <Plus className="size-5" aria-hidden />
            </button>
          </div>
        )}

        {expanded && (
          <div className="mt-1 flex justify-end border-t border-border pt-1">
            <button
              type="button"
              aria-label="Recolher reações"
              onClick={() => setExpanded(false)}
              className={cn(
                'inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-text-mid outline-none',
                'motion-safe:transition-colors hover:text-text focus-visible:focus-ring',
              )}
            >
              <X className="size-3.5" aria-hidden />
              Menos
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** Botão de um emoji do picker. ≥44px no mobile; estado ativo destacado. */
function EmojiButton({
  emoji,
  active,
  onClick,
}: {
  emoji: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-label={`Reagir com ${emoji}`}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-md text-xl leading-none outline-none sm:size-9',
        'motion-safe:transition-transform hover:bg-surface-2 motion-safe:hover:scale-110',
        'focus-visible:focus-ring',
        active && 'bg-surface-2 ring-1 ring-border',
      )}
    >
      <span aria-hidden>{emoji}</span>
    </button>
  );
}
