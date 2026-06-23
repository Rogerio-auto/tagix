'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/shared/stores/auth.store';
import { TourProvider, useTour } from './TourProvider';
import { APP_TOURS, TOUR_BY_PATHNAME } from './content';

/**
 * Ponto de montagem do tour guiado no shell do app (ONBOARDING.md §4 / F43-S08).
 *
 * Registra os tours reais de conteúdo (`APP_TOURS`, dashboard/inbox/pipeline/
 * agentes/flows — F43-S08) no `TourProvider` (engine F43-S07) e dispara o
 * AUTO-START por rota: ao entrar numa tela cujo tour o membro ainda não viu, o
 * tour abre uma vez. As âncoras `data-tour-id` moram nas próprias telas; se ainda
 * não existirem (lista vazia, render tardio), o engine pula os passos sem travar.
 *
 * Client-only por natureza (portal, foco, eventos). NÃO mora em `@hm/ui` (gotcha
 * do barrel client→server leak, F10).
 */
export function GuidedTourMount(): ReactNode {
  // Só consulta o estado de tour quando há sessão hidratada (evita 401 ruidoso e
  // chamada sem cookie). O provider lida com o membro sem `workspace.edit` (403)
  // tratando como "nenhum tour visto".
  const isAuthed = useAuthStore((s) => s.auth != null);

  return (
    <TourProvider tours={APP_TOURS} enabled={isAuthed}>
      {isAuthed && <RouteAutoStart />}
    </TourProvider>
  );
}

/**
 * Auto-start por rota (primeira visita do membro). Vive DENTRO do provider para
 * usar `useTour`. Dispara no máximo uma vez por (pathname × montagem da sessão):
 *
 * - Espera `isStateReady` para não correr antes de saber o que já foi visto.
 * - `start()` por si só não reabre tour visto/dispensado (`hasSeen` interno), mas
 *   guardamos a rota já tentada num ref para não re-tentar a cada re-render.
 * - Pequeno atraso por `requestAnimationFrame` dá tempo das âncoras montarem; se
 *   mesmo assim nenhuma existir, o engine simplesmente não inicia (retorna false).
 */
function RouteAutoStart(): null {
  const pathname = usePathname();
  const { start, hasSeen, isStateReady } = useTour();
  const attemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isStateReady) return;

    const tourId = TOUR_BY_PATHNAME[pathname];
    if (!tourId) return;

    // Já tentamos esta rota neste ciclo de montagem → não repetir.
    if (attemptedRef.current === pathname) return;
    if (hasSeen(tourId)) {
      attemptedRef.current = pathname;
      return;
    }

    // Dá um quadro para as telas montarem suas âncoras antes de resolver alvos.
    const raf = requestAnimationFrame(() => {
      attemptedRef.current = pathname;
      start(tourId);
    });
    return () => cancelAnimationFrame(raf);
  }, [pathname, isStateReady, hasSeen, start]);

  return null;
}
