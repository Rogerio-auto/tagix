'use client';

import { useEffect, useState } from 'react';

export interface CountdownState {
  /** Milissegundos restantes até o alvo (0 quando vencido ou sem alvo). */
  readonly remainingMs: number;
  /** True quando há alvo e ele já passou. */
  readonly isExpired: boolean;
}

/**
 * Contagem regressiva client-side até `targetIso` (F51). Um tick de 1s atualiza o relógio e o
 * valor é derivado a cada render; cleanup no unmount. No-op quando `targetIso` é null (execuções
 * `running`/terminais não têm deadline) — não cria interval e devolve estado neutro.
 */
export function useCountdown(targetIso: string | null): CountdownState {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!targetIso) return;
    setNow(Date.now()); // sincroniza ao montar/trocar de alvo
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);

  if (!targetIso) return { remainingMs: 0, isExpired: false };
  const remainingMs = Math.max(0, new Date(targetIso).getTime() - now);
  return { remainingMs, isExpired: remainingMs <= 0 };
}
