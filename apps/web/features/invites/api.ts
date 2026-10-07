import { z } from 'zod';
import { api } from '@/shared/lib/api-client';
import {
  createInviteResponseSchema,
  inviteAcceptResponseSchema,
  inviteLinkResponseSchema,
  invitePreviewSchema,
  inviteSendEmailResponseSchema,
  invitesListSchema,
  resendInviteResponseSchema,
  type AcceptInput,
  type CreateInviteInput,
} from './types';

/**
 * Chamadas da API de convites. O token SEMPRE vai no corpo (POST) — nunca em path ou
 * query —, e toda resposta passa por Zod: shape inesperado vira erro, não `undefined`
 * silencioso na tela.
 */
export const invitesApi = {
  // ─ públicas ─
  preview: async (token: string) =>
    invitePreviewSchema.parse(await api.post<unknown>('/auth/invite/preview', { token })),

  accept: async (input: AcceptInput) =>
    inviteAcceptResponseSchema.parse(await api.post<unknown>('/auth/invite/accept', input)),

  sendEmail: async (token: string) =>
    inviteSendEmailResponseSchema.parse(await api.post<unknown>('/auth/invite/send-email', { token })),

  /** Sessão atual, sem passar pelo store (que a S08 está mexendo): só o email importa aqui. */
  me: async () => {
    const data = z
      .object({ member: z.object({ email: z.string().optional(), name: z.string().optional() }) })
      .parse(await api.get<unknown>('/api/me'));
    return { email: data.member.email ?? null, name: data.member.name ?? null };
  },

  logout: () => api.post<unknown>('/auth/logout'),

  // ─ admin ─
  list: async () => invitesListSchema.parse(await api.get<unknown>('/api/members/invites')),

  create: async (input: CreateInviteInput) =>
    createInviteResponseSchema.parse(await api.post<unknown>('/api/members/invites', input)),

  resend: async (id: string) =>
    resendInviteResponseSchema.parse(await api.post<unknown>(`/api/members/invites/${id}/resend`)),

  revoke: (id: string) => api.delete<void>(`/api/members/invites/${id}`),

  link: async (id: string) =>
    inviteLinkResponseSchema.parse(await api.post<unknown>(`/api/members/invites/${id}/link`)),
};
export type InvitesApi = typeof invitesApi;
