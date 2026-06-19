'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Persistência client-side da dispensa do checklist "Primeiros passos" (F43-S06).
 *
 * A API S04 NÃO expõe endpoint de dismiss (o estado de onboarding cobre o wizard,
 * não o widget do dashboard). Dispensar o checklist é uma **preferência de UI de baixo
 * risco** — se a pessoa trocar de navegador ele reaparece, e some sozinho assim que
 * todos os passos estiverem `done` (estado derivado, sem depender disto). Por isso
 * persistimos em `localStorage`, com **chave por workspace** para que workspaces
 * distintos no mesmo navegador não compartilhem a decisão.
 *
 * Hidrata após o mount para não divergir do SSR (localStorage não existe no servidor).
 */
const KEY_PREFIX = 'leadium.onboarding.checklist.dismissed';

function storageKey(workspaceId: string): string {
  return `${KEY_PREFIX}.${workspaceId}`;
}

export function useChecklistDismissed(workspaceId: string | null): {
  dismissed: boolean;
  dismiss: () => void;
} {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (workspaceId == null) return;
    try {
      setDismissed(window.localStorage.getItem(storageKey(workspaceId)) === '1');
    } catch {
      // localStorage indisponível (modo privado/SSR) — trata como não-dispensado.
      setDismissed(false);
    }
  }, [workspaceId]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    if (workspaceId == null) return;
    try {
      window.localStorage.setItem(storageKey(workspaceId), '1');
    } catch {
      // Sem persistência: a dispensa vale só para esta sessão. Aceitável (baixo risco).
    }
  }, [workspaceId]);

  return { dismissed, dismiss };
}
