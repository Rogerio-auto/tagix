import { z } from 'zod';

/** Papéis que um convite pode carregar. OWNER nunca é convidável (API: owner_not_invitable). */
export const INVITABLE_ROLES = ['ADMIN', 'SUPERVISOR', 'AGENT', 'READONLY'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  AGENT: 'Atendente',
  READONLY: 'Somente leitura',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Artigo + papel para a frase "como Atendente". */
export const ROLE_HINTS: Record<InvitableRole, string> = {
  ADMIN: 'Gerencia a empresa, os membros e as configurações.',
  SUPERVISOR: 'Acompanha a equipe e as conversas de todos.',
  AGENT: 'Atende conversas e trabalha o funil.',
  READONLY: 'Vê tudo, sem alterar nada.',
};

// ─── Públicas (tela do convidado) ─────────────────────────────────────────────

export const invitePreviewSchema = z.object({
  workspaceName: z.string(),
  inviterName: z.string().nullable().optional(),
  role: z.string(),
  emailMasked: z.string(),
  requiresEmailProof: z.boolean(),
  expiresAt: z.string(),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

export const inviteAcceptResponseSchema = z.object({ next: z.string() });
export type InviteAcceptResponse = z.infer<typeof inviteAcceptResponseSchema>;

export const inviteSendEmailResponseSchema = z.object({
  ok: z.literal(true),
  emailMasked: z.string(),
});
export type InviteSendEmailResponse = z.infer<typeof inviteSendEmailResponseSchema>;

export const EMAIL_PROOF_TYPES = ['invite', 'magiclink'] as const;
export type EmailProofType = (typeof EMAIL_PROOF_TYPES)[number];

/** Prova de posse da caixa de email — vive só em memória, nunca em storage. */
export interface EmailProof {
  tokenHash: string;
  type: EmailProofType;
}

export interface AcceptInput {
  token: string;
  name?: string;
  password?: string;
  emailProof?: EmailProof;
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export const publicInviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  departmentId: z.string().nullable().optional(),
  invitedBy: z.string().nullable().optional(),
  createdAt: z.string(),
  expiresAt: z.string(),
  expired: z.boolean(),
  lastSentAt: z.string().nullable().optional(),
  sendCount: z.number(),
  resendsLeft: z.number(),
});
export type PublicInvite = z.infer<typeof publicInviteSchema>;

export const invitesListSchema = z.object({
  invites: z.array(publicInviteSchema),
  seats: z.object({ used: z.number(), limit: z.number().nullable() }),
});
export type InvitesList = z.infer<typeof invitesListSchema>;

export const createInviteResponseSchema = z.object({
  invite: publicInviteSchema,
  delivery: z.enum(['sent', 'failed']),
  resent: z.boolean().optional(),
});
export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>;

export const resendInviteResponseSchema = z.object({
  invite: publicInviteSchema,
  delivery: z.enum(['sent', 'failed']),
});
export type ResendInviteResponse = z.infer<typeof resendInviteResponseSchema>;

export const inviteLinkResponseSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
  invite: publicInviteSchema,
});
export type InviteLinkResponse = z.infer<typeof inviteLinkResponseSchema>;

export interface CreateInviteInput {
  email: string;
  role: InvitableRole;
  departmentId?: string;
}
