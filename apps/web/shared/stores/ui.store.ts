'use client';

import { create } from 'zustand';

export type Density = 'comfortable' | 'compact';

const DENSITY_KEY = 'hm:density';
const SIDEBAR_KEY = 'hm:sidebar';

interface UIState {
  density: Density;
  /** Lê as preferências persistidas (density + sidebar). Chamar uma vez no client após mount. */
  hydrate: () => void;
  setDensity: (density: Density) => void;
  toggleDensity: () => void;

  /** Sidebar (desktop) recolhida (só ícones) vs expandida. Persistido em localStorage. */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;

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
    const sb = localStorage.getItem(SIDEBAR_KEY);
    if (sb === '1' || sb === '0') set({ sidebarCollapsed: sb === '1' });
  },
  setDensity: (density) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(DENSITY_KEY, density);
    set({ density });
  },
  toggleDensity: () =>
    get().setDensity(get().density === 'comfortable' ? 'compact' : 'comfortable'),

  sidebarCollapsed: false,
  setSidebarCollapsed: (sidebarCollapsed) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? '1' : '0');
    }
    set({ sidebarCollapsed });
  },
  toggleSidebar: () => get().setSidebarCollapsed(!get().sidebarCollapsed),

  commandOpen: false,
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  toggleCommand: () => set({ commandOpen: !get().commandOpen }),
}));
