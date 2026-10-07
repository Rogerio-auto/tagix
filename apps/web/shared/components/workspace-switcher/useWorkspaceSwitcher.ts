'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore, type Membership } from '@/shared/stores/auth.store';
import { canSwitchWorkspace, performWorkspaceSwitch } from './switch-workspace';
import { useSwitchStore } from './switch.store';

export interface WorkspaceSwitcherState {
  memberships: Membership[];
  activeId: string | null;
  /** Nome da empresa ativa ('' enquanto a sessão hidrata). */
  activeName: string;
  /** Só vira seletor com 2+ empresas. */
  canSwitch: boolean;
  /** `true` enquanto uma troca está em curso (bloqueia nova troca). */
  busy: boolean;
  /** Id da empresa para a qual a troca está em curso. */
  pendingId: string | null;
  error: string | null;
  clearError: () => void;
  switchTo: (workspaceId: string) => Promise<boolean>;
}

/** Lê a empresa ativa/lista do store e expõe a troca (cache limpo + socket + `/`). */
export function useWorkspaceSwitcher(): WorkspaceSwitcherState {
  const router = useRouter();
  const queryClient = useQueryClient();
  const memberships = useAuthStore((s) => s.memberships);
  const workspace = useAuthStore((s) => s.workspace);
  const phase = useSwitchStore((s) => s.phase);
  const targetId = useSwitchStore((s) => s.targetId);
  const error = useSwitchStore((s) => s.error);
  const clearError = useSwitchStore((s) => s.clearError);

  const activeId = workspace?.id ?? null;
  const activeName =
    workspace?.name || memberships.find((m) => m.workspaceId === activeId)?.name || '';

  const switchTo = useCallback(
    async (workspaceId: string): Promise<boolean> => {
      const store = useSwitchStore.getState();
      if (store.phase !== 'idle') return false;
      const current = useAuthStore.getState().workspace?.id;
      if (workspaceId === current) return true;
      const target = useAuthStore.getState().memberships.find((m) => m.workspaceId === workspaceId);
      store.begin(workspaceId, target?.name ?? '');
      const result = await performWorkspaceSwitch({
        workspaceId,
        queryClient,
        navigate: () => {
          useSwitchStore.getState().navigating();
          router.replace('/');
          router.refresh();
        },
      });
      if (!result.ok) {
        useSwitchStore.getState().fail(result.message);
        return false;
      }
      return true;
    },
    [queryClient, router],
  );

  return {
    memberships,
    activeId,
    activeName,
    canSwitch: canSwitchWorkspace(memberships),
    busy: phase !== 'idle',
    pendingId: phase === 'idle' ? null : targetId,
    error,
    clearError,
    switchTo,
  };
}
