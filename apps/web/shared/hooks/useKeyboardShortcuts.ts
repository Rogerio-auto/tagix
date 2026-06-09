'use client';

import { useEffect, useRef } from 'react';

export interface Shortcut {
  /** Tecla (case-insensitive), ex.: 'k', 'Escape', '?'. */
  key: string;
  /** Exige Ctrl (Win/Linux) ou Cmd (mac). */
  ctrlOrMeta?: boolean;
  shift?: boolean;
  handler: (e: KeyboardEvent) => void;
}

/**
 * Registra atalhos globais (UX §2.10). Usa ref interna para sempre chamar o
 * handler mais recente sem re-assinar o listener a cada render.
 */
export function useKeyboardShortcuts(shortcuts: readonly Shortcut[]): void {
  const ref = useRef(shortcuts);
  ref.current = shortcuts;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const hasMod = e.ctrlKey || e.metaKey;
      for (const s of ref.current) {
        const modOk = s.ctrlOrMeta ? hasMod : !hasMod;
        const shiftOk = s.shift ? e.shiftKey : true;
        if (e.key.toLowerCase() === s.key.toLowerCase() && modOk && shiftOk) {
          e.preventDefault();
          s.handler(e);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
