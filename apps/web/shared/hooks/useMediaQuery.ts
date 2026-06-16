'use client';

import { useSyncExternalStore } from 'react';

/**
 * Assina uma media query (`matchMedia`) de forma SSR-safe.
 *
 * Usa `useSyncExternalStore` (React 18+) — o snapshot do servidor é `false` e o
 * primeiro snapshot do cliente é lido de forma síncrona via `getServerSnapshot`
 * vs `getSnapshot`, então o React resolve a hidratação sem flash nem warning:
 * o valor real entra no commit logo após a montagem, num único frame.
 *
 * @param query media query padrão CSS, ex.: '(min-width: 768px)'.
 * @returns `true` se a query casa no momento (sempre `false` no servidor).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => subscribe(query, onChange),
    () => getSnapshot(query),
    () => false,
  );
}

function subscribe(query: string, onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mql = window.matchMedia(query);
  // addEventListener é o caminho moderno; Safari < 14 usaria addListener, mas o
  // target de build é evergreen, então não carregamos o fallback legado.
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(query).matches;
}
