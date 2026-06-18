/**
 * Contratos compartilhados do Chat de Suporte (F38 — SUPPORT.md secao 2).
 * Fonte unica entre @hm/api (membro S07 + plataforma S10) e @hm/web (S09/S11).
 *
 * Enums espelham os CHECKs do schema (S01). Schemas Zod validam input externo.
 */
import { z } from 'zod';

export const SUPPORT_THREAD_STATUSES = ['open', 'pending', 'resolved'] as const;
export type SupportThreadStatusT = (typeof SUPPORT_THREAD_STATUSES)[number];

export const SUPPORT_THREAD_PRIORITIES = ['low', 'normal', 'high'] as const;
export type SupportThreadPriorityT = (typeof SUPPORT_THREAD_PRIORITIES)[number];

export const SUPPORT_SENDER_TYPES = ['member', 'platform'] as const;
export type SupportSenderTypeT = (typeof SUPPORT_SENDER_TYPES)[number];

// ─── Membro: abrir thread / enviar mensagem ──────────────────────────────────
export const supportOpenThreadSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  message: z.string().trim().min(1).max(10000),
  priority: z.enum(SUPPORT_THREAD_PRIORITIES).optional(),
});
export type SupportOpenThreadInput = z.infer<typeof supportOpenThreadSchema>;

export const supportSendMessageSchema = z.object({
  body: z.string().trim().min(1).max(10000),
});
export type SupportSendMessageInput = z.infer<typeof supportSendMessageSchema>;

// ─── Plataforma: filtros + patch (S10) ───────────────────────────────────────
export const supportPlatformFiltersSchema = z.object({
  status: z.enum(SUPPORT_THREAD_STATUSES).optional(),
  priority: z.enum(SUPPORT_THREAD_PRIORITIES).optional(),
  workspaceId: z.string().uuid().optional(),
});
export type SupportPlatformFilters = z.infer<typeof supportPlatformFiltersSchema>;

export const supportPlatformPatchSchema = z
  .object({
    status: z.enum(SUPPORT_THREAD_STATUSES).optional(),
    priority: z.enum(SUPPORT_THREAD_PRIORITIES).optional(),
    assignedTo: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.priority !== undefined || v.assignedTo !== undefined, {
    message: 'Informe ao menos status, priority ou assignedTo.',
  });
export type SupportPlatformPatch = z.infer<typeof supportPlatformPatchSchema>;

// ─── DTOs de resposta (tipam a UI) ───────────────────────────────────────────
export interface SupportThreadDTO {
  id: string;
  workspaceId: string;
  subject: string;
  status: SupportThreadStatusT;
  priority: SupportThreadPriorityT;
  assignedTo: string | null;
  lastMessageAt: string;
  createdAt: string | null;
}

export interface SupportMessageDTO {
  id: string;
  threadId: string;
  senderType: SupportSenderTypeT;
  senderId: string | null;
  body: string;
  createdAt: string | null;
}
