'use client';

import { useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '@/shared/stores/theme.store';

/**
 * Alternar tema no painel de plataforma (o shell do app tem o seu na TopBar). Sincroniza
 * com o `data-theme` que o script anti-flash já aplicou antes de oferecer a troca.
 */
export function PlatformThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const hydrate = useThemeStore((s) => s.hydrate);
  const toggle = useThemeStore((s) => s.toggle);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      className="touch-target grid place-items-center rounded-sm text-text-mid outline-none transition-colors duration-200 hover:bg-surface-2 hover:text-text focus-visible:focus-ring motion-reduce:transition-none"
    >
      {theme === 'dark' ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
    </button>
  );
}
