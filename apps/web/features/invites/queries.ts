'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/lib/api-client';
import { invitesApi } from './api';
import type { AcceptInput, CreateInviteInput } from './types';

/** Prefixo `['members']` = o mesmo de `orgKeys.members`: invalidar um invalida o outro. */
export const inviteKeys = {
  list: ['members', 'invites'] as const,
};

// ─── Tela do convidado ────────────────────────────────────────────────────────

/** Preview do convite. `retry:false` — 404 é resposta final, não falha transitória. */
export function useInvitePreview(token: string) {
  return useQuery({
    // Token na key só vive em memória do cache; `gcTime` curto não deixa sobrar.
    queryKey: ['invite-preview', token],
    queryFn: () => invitesApi.preview(token),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

/**
 * Quem está logado (se alguém). 401/sem empresa = deslogado, sem erro. Falha de rede
 * ou 5xx é `error` — a tela trata como "não sei", sem fingir que está deslogado.
 */
export function useInviteSession() {
  return useQuery({
    queryKey: ['invite-session'],
    queryFn: async () => {
      try {
        return await invitesApi.me();
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useAcceptInvite() {
  return useMutation({ mutationFn: (input: AcceptInput) => invitesApi.accept(input) });
}

export function useSendInviteEmail() {
  return useMutation({ mutationFn: (token: string) => invitesApi.sendEmail(token) });
}

export function useInviteLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invitesApi.logout(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['invite-session'] }),
  });
}

// ─── Admin (Configurações → Membros) ──────────────────────────────────────────

export function useInvites() {
  return useQuery({ queryKey: inviteKeys.list, queryFn: () => invitesApi.list() });
}

function useInvalidateMembers() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['members'] });
}

export function useCreateInvite() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: (input: CreateInviteInput) => invitesApi.create(input),
    onSuccess: invalidate,
  });
}

export function useResendInvite() {
  const invalidate = useInvalidateMembers();
  return useMutation({ mutationFn: (id: string) => invitesApi.resend(id), onSuccess: invalidate });
}

export function useRevokeInvite() {
  const invalidate = useInvalidateMembers();
  return useMutation({ mutationFn: (id: string) => invitesApi.revoke(id), onSuccess: invalidate });
}

/** Copiar link TROCA o token (o link do email morre) — por isso invalida a lista. */
export function useInviteLink() {
  const invalidate = useInvalidateMembers();
  return useMutation({ mutationFn: (id: string) => invitesApi.link(id), onSuccess: invalidate });
}
