'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import { SESSION_COOKIE } from '@/shared/lib/session';
import type { LoginInput, ResetInput } from './schema';

// Enquanto o backend de auth (F0-S05/S06) não existe, o mock deixa o fluxo
// navegável. Defina NEXT_PUBLIC_AUTH_MOCK=false quando a API real estiver pronta.
const AUTH_MOCK = process.env['NEXT_PUBLIC_AUTH_MOCK'] !== 'false';

export function useLogin() {
  return useMutation({
    mutationFn: async (input: LoginInput) => {
      if (AUTH_MOCK) {
        // TODO(auth F0-S05): substituir por POST /auth/login (cookie httpOnly no backend).
        document.cookie = `${SESSION_COOKIE}=mock; path=/; max-age=86400; samesite=lax`;
        return { ok: true } as const;
      }
      return api.post<{ ok: true }>('/auth/login', input);
    },
  });
}

export function useRequestReset() {
  return useMutation({
    mutationFn: async (input: ResetInput) => {
      if (AUTH_MOCK) return { ok: true } as const;
      return api.post<{ ok: true }>('/auth/reset', input);
    },
  });
}
