/**
 * Contratos de Inbox/visibilidade + handoff de IA (F30 — LIVECHAT_OPS.md §1/§2).
 * Fonte única (Zod) importada por API/web/db para validar e tipar o boundary.
 */
import { z } from 'zod';

/** Privacidade entre colegas resolvida (eixo 2). `inherit` é só override de time. */
export const PeerVisibilitySchema = z.enum(['shared', 'private']);
export type PeerVisibility = z.infer<typeof PeerVisibilitySchema>;

/** Override de privacidade por time (`teams.peer_visibility`): inclui `inherit`. */
export const TeamPeerVisibilitySchema = z.enum(['shared', 'private', 'inherit']);
export type TeamPeerVisibility = z.infer<typeof TeamPeerVisibilitySchema>;

/** Estado da IA por conversa (`conversations.ai_mode`). */
export const AiModeSchema = z.enum(['off', 'on', 'paused']);
export type AiMode = z.infer<typeof AiModeSchema>;

/** Motivo de pausa da IA (`conversations.ai_paused_reason`). */
export const AiPausedReasonSchema = z.enum(['human_takeover', 'manual']);
export type AiPausedReason = z.infer<typeof AiPausedReasonSchema>;

/** Política de visibilidade no nível do workspace (`inbox_visibility_settings`). */
export const VisibilityPolicySchema = z.object({
  defaultPeerVisibility: PeerVisibilitySchema.default('shared'),
  readonlySeesAll: z.boolean().default(true),
});
export type VisibilityPolicy = z.infer<typeof VisibilityPolicySchema>;
