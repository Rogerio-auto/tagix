'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import { snapshotFromMember, useAuthStore } from '@/shared/stores/auth.store';
import type { Role } from '@hm/shared';
import type { LoginInput, ResetInput, SignupInput } from './schema';

interface LoginResponse {
  member: { id: string; workspaceId: string; name: string; role: Role };
  workspace: { id: string };
  /**
   * KEY do plano escolhido na página de venda (signup), consumida 1x pela API.
   * Quando presente, o login redireciona ao checkout do plano em vez do dashboard.
   */
  pendingPlanKey?: string | null;
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

/** Reset real (F44-S04): POST /auth/reset — resposta uniforme anti-enumeração. */
export function useRequestReset() {
  return useMutation({
    mutationFn: (input: ResetInput) => api.post<{ ok: true }>('/auth/reset', input),
  });
}

/** Payload do signup self-serve: form + token do Turnstile + plano da venda. */
export interface SignupPayload extends SignupInput {
  turnstileToken: string;
  /** KEY do plano escolhido na página de venda (?plan=). Intenção — a API valida. */
  plan?: string;
}

/**
 * Cadastro self-serve (F44-S04). POST /auth/signup → 202 uniforme
 * { status:'verification_sent' }. SEM auto-login: o usuário confirma o email antes
 * de acessar. Não hidrata sessão.
 */
export function useSignup() {
  return useMutation({
    mutationFn: (input: SignupPayload) =>
      api.post<{ status: 'verification_sent' }>('/auth/signup', input),
  });
}

/** Confirma o email a partir do token do link (F44-S06). POST /auth/verify. */
export function useVerifyEmail() {
  return useMutation({
    mutationFn: (token: string) => api.post<{ ok: true }>('/auth/verify', { token }),
  });
}
