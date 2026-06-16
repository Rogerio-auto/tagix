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

// Mock só ativo em dev explicitamente. Em produção (NODE_ENV=production) nunca
// aplica, independente da env: impede que a flag vaze comportamento em prod.
const AUTH_MOCK =
  process.env['NODE_ENV'] !== 'production' &&
  process.env['NEXT_PUBLIC_AUTH_MOCK'] !== 'false';

export function useRequestReset() {
  return useMutation({
    mutationFn: async (input: ResetInput) => {
      if (AUTH_MOCK) return { ok: true } as const;
      return api.post<{ ok: true }>('/auth/reset', input);
    },
  });
}
