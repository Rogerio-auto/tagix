'use client';

import { Menu, Moon, Sun } from 'lucide-react';
import { useThemeStore } from '@/shared/stores/theme.store';

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);

  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b border-border bg-bg px-4 lg:px-8">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Abrir menu"
        className="rounded-sm p-2 text-text-mid outline-none transition-colors duration-200 hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md lg:hidden"
      >
        <Menu className="size-5" />
      </button>
      <div className="flex-1" />
      <button
        type="button"
        onClick={toggle}
        aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
        className="rounded-sm p-2 text-text-mid outline-none transition-colors duration-200 hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md"
      >
        {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
      </button>
    </header>
  );
}
