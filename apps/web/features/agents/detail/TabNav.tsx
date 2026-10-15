'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/shared/lib/cn';
import { AGENT_TABS, type AgentTabId } from './tabs';

/**
 * Navegação por tabs do detalhe do agente (UX §2 — tabs como navegação clara,
 * deep-linkáveis). Cada tab é um link real (`?tab=`), preservando o estado na URL
 * para refresh/compartilhamento. `role="tablist"` para acessibilidade.
 */
/**
 * Máscara de borda do trilho rolável: some nas pontas onde há mais abas escondidas,
 * para "Conhecimento" cortado a 375 px ler como "tem mais", não como texto quebrado.
 * Gradiente de opacidade (preto/transparente são alfa da máscara, não cor da UI).
 */
const FADE_CLASS = {
  none: '',
  end: '[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]',
  start: '[mask-image:linear-gradient(to_right,transparent,black_2.5rem)]',
  both: '[mask-image:linear-gradient(to_right,transparent,black_2.5rem,black_calc(100%-2.5rem),transparent)]',
} as const;

type Fade = keyof typeof FADE_CLASS;

/** Qual ponta do trilho tem conteúdo fora da vista (atualiza ao rolar e ao redimensionar). */
function useEdgeFade(): { ref: React.RefObject<HTMLDivElement | null>; fade: Fade; onScroll: () => void } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [fade, setFade] = useState<Fade>('none');

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // 1 px de folga: arredondamento de subpixel no fim do trilho.
    const start = el.scrollLeft > 1;
    const end = max - el.scrollLeft > 1;
    setFade(start && end ? 'both' : start ? 'start' : end ? 'end' : 'none');
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return { ref, fade, onScroll: measure };
}

export function TabNav({ basePath, active }: { basePath: string; active: AgentTabId }) {
  const { ref, fade, onScroll } = useEdgeFade();
  return (
    // Mobile: trilho de abas roláveis horizontalmente (scroll-x), sem quebra de
    // linha — MOBILE_UX §2 "detalhe c/ abas" — com fade nas pontas que escondem abas.
    // `md+`: inalterado (sem rolagem, sem máscara).
    <div
      ref={ref}
      onScroll={onScroll}
      role="tablist"
      aria-label="Seções do agente"
      className={cn(
        '-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:overflow-visible md:px-0 md:[mask-image:none]',
        FADE_CLASS[fade],
      )}
    >
      {AGENT_TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={`${basePath}?tab=${tab.id}`}
            role="tab"
            aria-selected={isActive}
            scroll={false}
            className={cn(
              'relative -mb-px flex shrink-0 items-center whitespace-nowrap rounded-t-sm px-4 py-2.5 font-body text-sm font-bold outline-none',
              'min-h-11 transition-colors duration-(--dur-fast) ease-ds focus-visible:focus-ring motion-reduce:transition-none',
              isActive
                ? 'border-b-2 border-brand-text text-text'
                : 'border-b-2 border-transparent text-text-low hover:text-text',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
