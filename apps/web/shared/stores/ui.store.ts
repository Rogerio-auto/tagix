'use client';

import { create } from 'zustand';

export type Density = 'comfortable' | 'compact';

const DENSITY_KEY = 'hm:density';

interface UIState {
  density: Density;
  /** Lê a density persistida (chamar uma vez no client após mount). */
  hydrate: () => void;
  setDensity: (density: Density) => void;
  toggleDensity: () => void;

  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  toggleCommand: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  density: 'comfortable',
  hydrate: () => {
    if (typeof localStorage === 'undefined') return;
    const v = localStorage.getItem(DENSITY_KEY);
    if (v === 'compact' || v === 'comfortable') set({ density: v });
  },
  setDensity: (density) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(DENSITY_KEY, density);
    set({ density });
  },
  toggleDensity: () =>
    get().setDensity(get().density === 'comfortable' ? 'compact' : 'comfortable'),

  commandOpen: false,
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  toggleCommand: () => set({ commandOpen: !get().commandOpen }),
}));
