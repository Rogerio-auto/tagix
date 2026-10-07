'use client';

import { create } from 'zustand';
import { z } from 'zod';
import type { MemberId, Role, WorkspaceId } from '@hm/shared';
import { ApiError, api } from '@/shared/lib/api-client';

export interface AuthSnapshot {
  memberId: MemberId;
  workspaceId: WorkspaceId;
  name: string;
  role: Role;
}

const ROLE_SCHEMA = z.enum(['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT', 'READONLY']);

/** Status de assinatura da empresa (`workspaces.subscription_status`). */
export const SUBSCRIPTION_STATUS_SCHEMA = z.enum([
  'trial',
  'active',
  'past_due',
  'expired',
  'canceled',
]);
export type SubscriptionStatus = z.infer<typeof SUBSCRIPTION_STATUS_SCHEMA>;

/** Uma empresa em que a pessoa tem membership ativa (`memberships[]` de `/api/me`). */
export const MEMBERSHIP_SCHEMA = z.object({
  workspaceId: z.string().min(1),
  name: z.string(),
  slug: z.string().optional(),
  role: ROLE_SCHEMA,
  subscriptionStatus: SUBSCRIPTION_STATUS_SCHEMA.catch('active'),
});
export type Membership = z.infer<typeof MEMBERSHIP_SCHEMA>;

/** Empresa ativa, com o que o shell precisa para as faixas de conta. */
export interface ActiveWorkspace {
  id: string;
  name: string;
  subscriptionStatus: SubscriptionStatus;
  /** ISO do fim do trial; `null` fora de trial. */
  trialEndsAt: string | null;
}

/**
 * Shape de `GET /api/me` / `POST /api/me/workspace` / `POST /auth/login`
 * (member é o `publicMember` da API). `workspace` é a linha inteira da empresa;
 * só lemos o que o shell usa. `memberships` ausente (login antigo) vira `[]`.
 */
const ME_SCHEMA = z.object({
  member: z.object({
    id: z.string(),
    workspaceId: z.string(),
    name: z.string(),
    role: ROLE_SCHEMA,
    status: z.string().optional(),
  }),
  workspace: z.object({
    id: z.string(),
    name: z.string().optional(),
    subscriptionStatus: SUBSCRIPTION_STATUS_SCHEMA.catch('active').optional(),
    trialEndsAt: z.string().nullable().optional(),
  }),
  memberships: z.array(MEMBERSHIP_SCHEMA).optional(),
});
export type MeResponse = z.infer<typeof ME_SCHEMA>;

/** Valida a resposta de `/api/me` (lança `ZodError` se o contrato quebrar). */
export function parseMe(raw: unknown): MeResponse {
  return ME_SCHEMA.parse(raw);
}

function workspaceFromMe(me: MeResponse): ActiveWorkspace {
  const fromList = (me.memberships ?? []).find((m) => m.workspaceId === me.workspace.id);
  return {
    id: me.workspace.id,
    name: me.workspace.name ?? fromList?.name ?? '',
    subscriptionStatus: me.workspace.subscriptionStatus ?? fromList?.subscriptionStatus ?? 'active',
    trialEndsAt: me.workspace.trialEndsAt ?? null,
  };
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
export function snapshotFromMember(
  m: Pick<MeResponse['member'], 'id' | 'workspaceId' | 'name' | 'role'>,
): AuthSnapshot {
  return {
    memberId: m.id as MemberId,
    workspaceId: m.workspaceId as WorkspaceId,
    name: m.name,
    role: m.role,
  };
}

interface AuthState {
  auth: AuthSnapshot | null;
  /** Empresa ativa (status de assinatura incluído); `null` até hidratar. */
  workspace: ActiveWorkspace | null;
  /** Empresas da pessoa, em ordem de uso (a ativa é a de `workspace.id`). */
  memberships: Membership[];
  /** Estado de hidratação — base de um splash determinístico e fail-closed (F44-S07). */
  status: AuthStatus;
  setAuth: (auth: AuthSnapshot | null) => void;
  /** Aplica um payload de `/api/me` já validado (hidratação e troca de empresa). */
  applyMe: (me: MeResponse) => void;
  /**
   * O servidor respondeu 402 `subscription_inactive`: a empresa ativa está sem
   * escrita. Reflete já na UI (faixa de só leitura) sem esperar um novo `/api/me`.
   */
  markSubscriptionInactive: () => void;
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

const signedOut = (): Pick<AuthState, 'auth' | 'workspace' | 'memberships'> => ({
  auth: null,
  workspace: null,
  memberships: [],
});

export const useAuthStore = create<AuthState>((set, get) => ({
  auth: null,
  workspace: null,
  memberships: [],
  status: 'idle',
  setAuth: (auth) =>
    set(auth ? { auth, status: 'authenticated' } : { ...signedOut(), status: 'unauthenticated' }),
  applyMe: (me) =>
    set({
      auth: snapshotFromMember(me.member),
      workspace: workspaceFromMe(me),
      memberships: me.memberships ?? [],
      status: 'authenticated',
    }),
  markSubscriptionInactive: () =>
    set((state) => {
      const ws = state.workspace;
      if (!ws || ws.subscriptionStatus === 'expired' || ws.subscriptionStatus === 'canceled') {
        return state;
      }
      return { workspace: { ...ws, subscriptionStatus: 'expired' } };
    }),
  hydrate: async () => {
    set({ status: 'loading' });
    try {
      const me = parseMe(await api.get<unknown>('/api/me'));
      // Bloqueio duro de email não verificado (F44 §2.1): a API só devolve member
      // com sessão plena quando ativo; se vier um status pré-verify, não entra no app.
      if (me.member.status !== undefined && me.member.status !== 'active') {
        set({ ...signedOut(), status: 'unverified' });
        return;
      }
      get().applyMe(me);
    } catch (err) {
      // Fail-closed: nunca deixa a UI num estado ambíguo "logado".
      if (err instanceof ApiError && err.status === 401) {
        set({ ...signedOut(), status: 'unauthenticated' });
      } else {
        set({ ...signedOut(), status: 'error' });
      }
    }
  },
}));
