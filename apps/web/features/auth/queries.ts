'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { LoginInput, ResetInput } from './schema';

interface LoginResponse {
  member: unknown;
  workspace: unknown;
}

/** Login real: POST /auth/login → a API seta o cookie httpOnly de sessão. */
export function useLogin() {
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<LoginResponse>('/auth/login', input),
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
