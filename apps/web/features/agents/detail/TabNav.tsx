'use client';

import Link from 'next/link';
import { cn } from '@/shared/lib/cn';
import { AGENT_TABS, type AgentTabId } from './tabs';

/**
 * Navegação por tabs do detalhe do agente (UX §2 — tabs como navegação clara,
 * deep-linkáveis). Cada tab é um link real (`?tab=`), preservando o estado na URL
 * para refresh/compartilhamento. `role="tablist"` para acessibilidade.
 */
export function TabNav({ basePath, active }: { basePath: string; active: AgentTabId }) {
  return (
    // Mobile: trilho de abas roláveis horizontalmente (scroll-x), sem quebra de
    // linha — MOBILE_UX §2 "detalhe c/ abas". `md+`: inalterado.
    <div
      role="tablist"
      aria-label="Seções do agente"
      className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:overflow-visible md:px-0"
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
              'relative -mb-px flex shrink-0 items-center whitespace-nowrap rounded-t-sm px-4 py-2.5 font-head text-sm font-medium outline-none',
              'min-h-11 transition-colors duration-200 focus-visible:shadow-glow-md',
              isActive
                ? 'border-b-2 border-brand text-text'
                : 'border-b-2 border-transparent text-text-low hover:text-text-mid',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
