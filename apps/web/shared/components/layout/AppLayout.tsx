'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { SkipLink } from './SkipLink';
import { TopBar } from './TopBar';
import { CommandPalette } from '@/shared/components/command';
import { useUIStore } from '@/shared/stores/ui.store';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';

export function AppLayout({ children }: { children: ReactNode }) {
  const hydrate = useUIStore((s) => s.hydrate);
  const hydrateAuth = useAuthStore((s) => s.hydrate);
  // Regra de ouro do MOBILE_UX: a ESTRUTURA do chrome (Sidebar vs BottomNav)
  // alterna por `isMobile`, não por classe Tailwind `md:` (que só montaria/
  // ocultaria via CSS, mantendo ambas no DOM). SSR-safe: snapshot mobile primeiro.
  const { isMobile } = useBreakpoint();

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
    <div className="flex h-dvh overflow-hidden bg-bg">
      <SkipLink />
      {!isMobile && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar compact={isMobile} />
        {/* tabIndex={-1} torna o <main> alvo programático do skip-link sem entrar
            na ordem natural de Tab (WCAG 2.4.1). */}
        <main
          id="main-content"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-6 outline-none lg:px-8"
        >
          {children}
        </main>
        {isMobile && <BottomNav />}
      </div>
      {/* Paleta de comandos global (⌘/Ctrl+K) — montada uma vez aqui. */}
      <CommandPalette />
    </div>
  );
}
