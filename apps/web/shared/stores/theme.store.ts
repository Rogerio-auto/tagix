'use client';

import { create } from 'zustand';
import type { ThemeName } from '@hm/design-tokens';

const STORAGE_KEY = 'hm:theme';

interface ThemeState {
  theme: ThemeName;
  /** Sincroniza o store com o `data-theme` já aplicado pelo script anti-flash. */
  hydrate: () => void;
  setTheme: (theme: ThemeName) => void;
  toggle: () => void;
}

function apply(theme: ThemeName): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset['theme'] = theme;
  localStorage.setItem(STORAGE_KEY, theme);
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'dark',
  hydrate: () => {
    if (typeof document === 'undefined') return;
    const current = document.documentElement.dataset['theme'] === 'light' ? 'light' : 'dark';
    set({ theme: current });
  },
  setTheme: (theme) => {
    apply(theme);
    set({ theme });
  },
  toggle: () => {
    const next: ThemeName = get().theme === 'dark' ? 'light' : 'dark';
    apply(next);
    set({ theme: next });
  },
}));
