'use client';

import { useEffect, useState } from 'react';
import { Moon, Search, Sun } from 'lucide-react';
import { useThemeStore } from '@/shared/stores/theme.store';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useUIStore } from '@/shared/stores/ui.store';
import { cn } from '@/shared/lib/cn';
import { useWorkspaceSwitcher } from '@/shared/components/workspace-switcher';
import { MarketPill } from './MarketPill';
import { UserMenu } from './UserMenu';
import { NotificationBell } from '@/features/notifications';

const ICON_BUTTON =
  'touch-target grid place-items-center rounded-sm text-text-mid outline-none transition-colors duration-200 motion-reduce:transition-none hover:bg-surface-2 hover:text-text focus-visible:focus-ring';

/** Rótulo do atalho da paleta; começa neutro e troca no cliente (sem mismatch de hidratação). */
function useShortcutLabel(): string {
  const [label, setLabel] = useState('Ctrl K');
  useEffect(() => {
    if (/mac|iphone|ipad/i.test(navigator.platform)) setLabel('⌘K');
  }, []);
  return label;
}

/**
 * Barra superior do app (68px no desktop).
 *
 * Desktop: gatilho de busca/⌘K à esquerda (abre a `CommandPalette`), pílula de
 * mercado reservada, notificações e tema à direita; perfil mora na `Sidebar`.
 * Mobile (`compact`): empresa à esquerda; busca, notificações,
 * e conta à direita (o tema vai dentro do menu da conta) (a navegação vai para a `BottomNav`).
 *
 * Safe-area: o `pt-safe` do notch é de UM dono só. Se há faixa de conta/view-as acima,
 * ela já o aplicou e o `AppShellFrame` zera o desta barra (`[data-topbar]`); sem faixa,
 * a barra aplica. Antes os dois somavam (a barra ganhava um recuo morto sob a faixa).
 */
export function TopBar({ compact = false }: { compact?: boolean }) {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const auth = useAuthStore((st) => st.auth);
  const setCommandOpen = useUIStore((s) => s.setCommandOpen);
  const shortcut = useShortcutLabel();
  const { activeName } = useWorkspaceSwitcher();

  const themeButton = (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      className={ICON_BUTTON}
    >
      {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );

  if (compact) {
    return (
      <header
        data-topbar
        className="shrink-0 border-b border-border bg-surface-glass pt-safe backdrop-blur-xl"
      >
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          {/* Só a empresa: o título da tela é o `<h1>` do `PageHeader` (um por tela,
              F70-S32); repeti-lo aqui duplicaria a mesma palavra a 40px de distância. */}
          <p className="min-w-0 truncate font-head text-lg font-semibold tracking-tight text-text">
            {activeName ?? 'tagix'}
          </p>
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              aria-label="Buscar ou ir para"
              aria-haspopup="dialog"
              className={ICON_BUTTON}
            >
              <Search className="size-5" aria-hidden />
            </button>
            <NotificationBell />
            {/* Tema mora no menu da conta (4 ícones em 360px era ruído). Paridade mobile (UX §8): no desktop o perfil/logout mora na Sidebar;
                aqui ele aparece como avatar — identidade e sessão nunca ficam só no
                desktop. */}
            {auth && (
              <UserMenu name={auth.name} role={auth.role} placement="down" variant="compact" />
            )}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header
      data-topbar
      className={cn(
        'flex h-17 shrink-0 items-center justify-between gap-4 border-b border-border px-8',
        'bg-surface-glass pt-safe backdrop-blur-xl',
      )}
    >
      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        aria-label="Buscar ou ir para"
        aria-haspopup="dialog"
        className={cn(
          'flex h-10 w-full max-w-sm items-center gap-3 rounded-sm border border-border bg-surface px-3',
          'text-left outline-none transition-colors duration-200 motion-reduce:transition-none',
          'hover:border-border-2 hover:bg-surface-2 focus-visible:focus-ring',
        )}
      >
        <Search className="size-4 shrink-0 text-text-low" aria-hidden />
        <span className="flex-1 truncate font-body text-sm text-text-low">Buscar ou ir para…</span>
        <kbd className="shrink-0 rounded-xs border border-border bg-surface-2 px-1.5 py-1 font-mono text-[0.6875rem] font-medium leading-none text-text-low">
          {shortcut}
        </kbd>
      </button>
      <div className="flex items-center gap-1">
        <MarketPill />
        <NotificationBell />
        {themeButton}
      </div>
    </header>
  );
}
