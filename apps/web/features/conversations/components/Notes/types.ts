/** Tipos das notas internas (F1-S22) — espelham o JSON da API @hm/api. */

export interface ConversationNote {
  id: string;
  conversationId: string;
  authorMemberId: string | null;
  body: string;
  /** Ids de membros mencionados (`@member`). */
  mentions: string[];
  createdAt: string;
  updatedAt: string | null;
}

/** Membro disponível para menção (`@member`). Subconjunto de `members`. */
export interface MentionableMember {
  id: string;
  name: string | null;
  email: string;
  avatarUrl?: string | null;
}

export interface CreateNoteInput {
  conversationId: string;
  body: string;
  mentions: string[];
}
