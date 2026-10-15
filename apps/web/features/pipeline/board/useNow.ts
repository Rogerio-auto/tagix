'use client';

import { useEffect, useState } from 'react';

/** Relógio de baixa frequência (default 60s) para rótulos relativos; sem timers por card. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
