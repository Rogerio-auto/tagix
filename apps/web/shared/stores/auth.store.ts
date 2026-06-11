'use client';

import { create } from 'zustand';
import type { MemberId, Role, WorkspaceId } from '@hm/shared';
import { ApiError, api } from '@/shared/lib/api-client';

export interface AuthSnapshot {
  memberId: MemberId;
  workspaceId: WorkspaceId;
  name: string;
  role: Role;
}

/** Shape de `GET /api/me` / `POST /auth/login` (member é o `publicMember` da API). */
interface MeResponse {
  member: { id: string; workspaceId: string; name: string; role: Role };
  workspace: { id: string };
}

/** Projeta a resposta da API no snapshot de auth do cliente. */
export function snapshotFromMember(m: MeResponse['member']): AuthSnapshot {
  return {
    memberId: m.id as MemberId,
    workspaceId: m.workspaceId as WorkspaceId,
    name: m.name,
    role: m.role,
  };
}

interface AuthState {
  auth: AuthSnapshot | null;
  setAuth: (auth: AuthSnapshot | null) => void;
  /**
   * Hidrata a auth a partir de `GET /api/me` (cookie de sessão httpOnly).
   * Chamado no mount do AppLayout — cobre refresh/abertura por URL direta, onde
   * o store em memória reinicia. Sem isso, `role` fica `undefined` e todo gating
   * de UI (sidebar, páginas que usam `can()`) falha fechado mesmo logado.
   */
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  auth: null,
  setAuth: (auth) => set({ auth }),
  hydrate: async () => {
    try {
      const { member } = await api.get<MeResponse>('/api/me');
      set({ auth: snapshotFromMember(member) });
    } catch (err) {
      // 401 = sem sessão → limpa. Outros erros (blip de rede) não derrubam o nav.
      if (err instanceof ApiError && err.status === 401) set({ auth: null });
    }
  },
}));
