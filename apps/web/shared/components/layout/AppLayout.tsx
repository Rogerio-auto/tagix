'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { SkipLink } from './SkipLink';
import { TopBar } from './TopBar';
import { CommandPalette } from '@/shared/components/command';
import { useUIStore } from '@/shared/stores/ui.store';
import { useAuthStore } from '@/shared/stores/auth.store';

export function AppLayout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const hydrate = useUIStore((s) => s.hydrate);
  const hydrateAuth = useAuthStore((s) => s.hydrate);

  // Restaura a preferência de density persistida.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Hidrata a auth (role/workspace) de /api/me — sem isso o gating de UI falha
  // fechado em refresh/URL direta, escondendo nav e bloqueando páginas com can().
  useEffect(() => {
    void hydrateAuth();
  }, [hydrateAuth]);

  return (
    <div className="flex min-h-dvh bg-bg">
      <SkipLink />
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} />
        {/* tabIndex={-1} torna o <main> alvo programático do skip-link sem entrar
            na ordem natural de Tab (WCAG 2.4.1). */}
        <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-6 outline-none lg:px-8">
          {children}
        </main>
      </div>
      {/* Paleta de comandos global (⌘/Ctrl+K) — montada uma vez aqui. */}
      <CommandPalette />
    </div>
  );
}
