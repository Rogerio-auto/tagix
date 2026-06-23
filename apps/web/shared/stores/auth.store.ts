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
  member: { id: string; workspaceId: string; name: string; role: Role; status?: string };
  workspace: { id: string };
}

/**
 * Estado de hidratação da sessão (F44-S07): explícito p/ um loading determinístico
 * e fail-closed. `idle` = ainda não tentou; `loading` = em voo; `authenticated` =
 * sessão plena; `unauthenticated` = sem sessão (401); `unverified` = sessão existe
 * mas o email não foi confirmado (bloqueio duro — não entra no app); `error` =
 * falha não-401 (rede), tratada como NÃO autenticado (fail-closed) sem derrubar o nav.
 */
export type AuthStatus =
  | 'idle'
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'
  | 'unverified'
  | 'error';

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
  /** Estado de hidratação — base de um splash determinístico e fail-closed (F44-S07). */
  status: AuthStatus;
  setAuth: (auth: AuthSnapshot | null) => void;
  /**
   * Hidrata a auth a partir de `GET /api/me` (cookie de sessão httpOnly).
   * Chamado no mount do AppLayout — cobre refresh/abertura por URL direta, onde
   * o store em memória reinicia. Sem isso, `role` fica `undefined` e todo gating
   * de UI (sidebar, páginas que usam `can()`) falha fechado mesmo logado.
   *
   * Fail-closed: qualquer erro deixa `auth=null` (UI não assume "logado"). Distingue
   * 401 (unauthenticated), member não-verificado (unverified) e blip de rede (error).
   */
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  auth: null,
  status: 'idle',
  setAuth: (auth) => set({ auth, status: auth ? 'authenticated' : 'unauthenticated' }),
  hydrate: async () => {
    set({ status: 'loading' });
    try {
      const { member } = await api.get<MeResponse>('/api/me');
      // Bloqueio duro de email não verificado (F44 §2.1): a API só devolve member
      // com sessão plena quando ativo; se vier um status pré-verify, não entra no app.
      if (member.status !== undefined && member.status !== 'active') {
        set({ auth: null, status: 'unverified' });
        return;
      }
      set({ auth: snapshotFromMember(member), status: 'authenticated' });
    } catch (err) {
      // Fail-closed: nunca deixa a UI num estado ambíguo "logado".
      if (err instanceof ApiError && err.status === 401) {
        set({ auth: null, status: 'unauthenticated' });
      } else {
        set({ auth: null, status: 'error' });
      }
    }
  },
}));
