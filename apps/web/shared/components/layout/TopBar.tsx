'use client';

import { usePathname } from 'next/navigation';
import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '@/shared/stores/theme.store';
import { useAuthStore } from '@/shared/stores/auth.store';
import { cn } from '@/shared/lib/cn';
import { activeNavItem, visibleNavItems } from './nav';

/**
 * Barra superior do app. No desktop é minimalista (só ações essenciais — a nav
 * mora na `Sidebar`). No mobile (`compact`) vira contexto: marca + título da
 * rota atual à esquerda (a navegação primária vai para a `BottomNav`, na zona do
 * polegar). Respeita a safe-area do topo (`pt-safe`) para o notch.
 */
export function TopBar({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const role = useAuthStore((st) => st.auth?.role);

  const title = compact ? activeNavItem(visibleNavItems(role), pathname)?.label : undefined;

  return (
    <header
      className={cn(
        'flex h-14 items-center justify-between gap-3 border-b border-border bg-bg px-4 md:px-8',
        compact && 'pt-safe h-auto min-h-14',
      )}
    >
      {compact ? (
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-display text-base text-brand" aria-hidden>
            ◢
          </span>
          <h1 className="truncate font-head text-base font-semibold text-text">
            {title ?? 'Highermind'}
          </h1>
        </div>
      ) : (
        <div className="flex-1" />
      )}
      <button
        type="button"
        onClick={toggle}
        aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
        className="touch-target -mr-2 grid place-items-center rounded-sm text-text-mid outline-none transition-colors duration-200 hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md"
      >
        {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
      </button>
    </header>
  );
}
