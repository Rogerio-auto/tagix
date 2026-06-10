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
    <div role="tablist" aria-label="Seções do agente" className="flex gap-1 border-b border-border">
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
              'relative -mb-px rounded-t-sm px-4 py-2.5 font-head text-sm font-medium outline-none',
              'transition-colors duration-200 focus-visible:shadow-glow-md',
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
