'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { SkipLink } from './SkipLink';
import { TopBar } from './TopBar';
import { CommandPalette } from '@/shared/components/command';
import { useUIStore } from '@/shared/stores/ui.store';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { cn } from '@/shared/lib/cn';

/**
 * Rotas full-bleed: a tela ocupa toda a área do `<main>` (sem gutter/scroll do
 * shell — ela gere o próprio scroll e preenche edge-to-edge). Hoje: o LiveChat,
 * que precisa ficar TOTALMENTE integrado à página (sem card flutuante).
 */
function isFullBleed(pathname: string): boolean {
  return pathname === '/conversations' || pathname.startsWith('/conversations/');
}

export function AppLayout({ children }: { children: ReactNode }) {
  const hydrate = useUIStore((s) => s.hydrate);
  const hydrateAuth = useAuthStore((s) => s.hydrate);
  // Regra de ouro do MOBILE_UX: a ESTRUTURA do chrome (Sidebar vs BottomNav)
  // alterna por `isMobile`, não por classe Tailwind `md:` (que só montaria/
  // ocultaria via CSS, mantendo ambas no DOM). SSR-safe: snapshot mobile primeiro.
  const { isMobile } = useBreakpoint();
  const pathname = usePathname();
  const fullBleed = isFullBleed(pathname ?? '');

  // Restaura a preferência de density persistida.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Hidrata a auth (role/workspace) de /api/me — sem isso o gating de UI falha
  // fechado em refresh/URL direta, escondendo nav e bloqueando páginas com can().
  useEffect(() => {
    void hydrateAuth();
  }, [hydrateAuth]);

  // Trava o scroll do DOCUMENTO enquanto o shell do app está montado. O app é um
  // shell de altura fixa (`h-dvh`) com scroll APENAS interno (no `<main>` ou nas
  // áreas internas do LiveChat). Sem esta trava, um overflow residual de qualquer
  // camada interna fazia a página inteira (sidebar incluída) scrollar — o "scroll
  // fantasma" em chats com histórico longo. Escopado e reversível: só vale enquanto
  // o AppLayout (rotas do grupo `(app)`) está montado; auth/platform (que usam
  // `min-h-dvh` + scroll de documento) têm layout próprio e não são afetados.
  useEffect(() => {
    const html = document.documentElement;
    const { body } = document;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
    };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      body.style.overscrollBehavior = prev.bodyOverscroll;
    };
  }, []);

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
          className={cn(
            'min-h-0 flex-1 outline-none',
            // Full-bleed (LiveChat): sem gutter nem scroll do shell. Vira um FLEX
            // COLUMN para a tela-filha preencher a altura via `flex-1 min-h-0`
            // (determinístico — sem `height:%` que não resolve sob flex e fazia a
            // página inteira scrollar). Demais rotas mantêm o gutter + scroll.
            fullBleed
              ? 'flex flex-col overflow-hidden'
              : 'overflow-y-auto px-4 py-6 lg:px-8',
          )}
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
