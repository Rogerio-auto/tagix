'use client';

import { useUIStore, type Density } from '@/shared/stores/ui.store';

/** Preferência de densidade das listas (UX §3.8). Persistida em localStorage. */
export function useDensity(): {
  density: Density;
  setDensity: (d: Density) => void;
  toggle: () => void;
} {
  const density = useUIStore((s) => s.density);
  const setDensity = useUIStore((s) => s.setDensity);
  const toggle = useUIStore((s) => s.toggleDensity);
  return { density, setDensity, toggle };
}
