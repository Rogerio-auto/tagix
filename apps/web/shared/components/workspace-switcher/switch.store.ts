'use client';

import { create } from 'zustand';

/**
 * Estado da troca de empresa, compartilhado entre o seletor (Sidebar/UserMenu), o
 * overlay de transição e os atalhos. `idle` → `switching` (POST em voo) →
 * `navigating` (cache limpo, indo para `/`) → `idle`.
 */
export type SwitchPhase = 'idle' | 'switching' | 'navigating';

interface SwitchState {
  phase: SwitchPhase;
  targetId: string | null;
  targetName: string | null;
  error: string | null;
  begin: (targetId: string, targetName: string) => void;
  navigating: () => void;
  fail: (message: string) => void;
  finish: () => void;
  clearError: () => void;
}

export const useSwitchStore = create<SwitchState>((set) => ({
  phase: 'idle',
  targetId: null,
  targetName: null,
  error: null,
  begin: (targetId, targetName) => set({ phase: 'switching', targetId, targetName, error: null }),
  navigating: () => set({ phase: 'navigating' }),
  fail: (message) => set({ phase: 'idle', targetId: null, targetName: null, error: message }),
  finish: () => set({ phase: 'idle', targetId: null, targetName: null }),
  clearError: () => set({ error: null }),
}));
