'use client';

import { create } from 'zustand';
import type { MemberId, Role, WorkspaceId } from '@hm/shared';

export interface AuthSnapshot {
  memberId: MemberId;
  workspaceId: WorkspaceId;
  name: string;
  role: Role;
}

interface AuthState {
  auth: AuthSnapshot | null;
  setAuth: (auth: AuthSnapshot | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  auth: null,
  setAuth: (auth) => set({ auth }),
}));
