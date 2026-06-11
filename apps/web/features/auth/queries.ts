'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import { snapshotFromMember, useAuthStore } from '@/shared/stores/auth.store';
import type { Role } from '@hm/shared';
import type { LoginInput, ResetInput } from './schema';

interface LoginResponse {
  member: { id: string; workspaceId: string; name: string; role: Role };
  workspace: { id: string };
}

/**
 * Login real: POST /auth/login → a API seta o cookie httpOnly de sessão e
 * devolve o member. Hidratamos o store na hora (sem esperar o /api/me) para o
 * nav e o gating de UI já aparecerem certos ao cair no app.
 */
export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<LoginResponse>('/auth/login', input),
    onSuccess: (data) => setAuth(snapshotFromMember(data.member)),
  });
}

// O endpoint real de reset de senha ainda não existe; o mock mantém o fluxo
// navegável até ele chegar. Defina NEXT_PUBLIC_AUTH_MOCK=false para forçar o real.
const AUTH_MOCK = process.env['NEXT_PUBLIC_AUTH_MOCK'] !== 'false';

export function useRequestReset() {
  return useMutation({
    mutationFn: async (input: ResetInput) => {
      if (AUTH_MOCK) return { ok: true } as const;
      return api.post<{ ok: true }>('/auth/reset', input);
    },
  });
}
