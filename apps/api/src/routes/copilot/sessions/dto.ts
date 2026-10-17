/**
 * Linhas do banco → DTOs públicos de sessão e mensagem (`@hm/shared` §Sessões).
 *
 * `blocks` e `tool_results` vêm de `jsonb`: são revalidados no contrato a cada leitura. Um
 * valor que não valida (linha antiga, gravação parcial) sai como `null`, e não derruba o
 * histórico inteiro.
 */
import { z } from 'zod';
import type { CopilotMessageRow, CopilotSessionRow } from '@hm/db';
import {
  CopilotAnswerBlocksSchema,
  ToolResultCardSchema,
  type CopilotMessage,
  type CopilotSession,
} from '@hm/shared';

/** Título de sessão ainda sem pergunta. */
export const UNTITLED_SESSION = 'Nova conversa';
const MESSAGE_CONTENT_MAX = 4000;
const ToolResultsSchema = z.array(ToolResultCardSchema).max(20);

export function toSessionDTO(row: CopilotSessionRow): CopilotSession {
  return {
    id: row.id,
    title: (row.title ?? '').trim().slice(0, 80) || UNTITLED_SESSION,
    origin: row.origin,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    archived_at: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

export function toMessageDTO(
  row: Pick<
    CopilotMessageRow,
    'id' | 'role' | 'content' | 'blocks' | 'toolResults' | 'proposalId' | 'createdAt'
  >,
): CopilotMessage {
  const blocks = row.blocks === null ? null : CopilotAnswerBlocksSchema.safeParse(row.blocks);
  const cards = row.toolResults === null ? null : ToolResultsSchema.safeParse(row.toolResults);
  return {
    id: row.id,
    role: row.role,
    content: row.content.slice(0, MESSAGE_CONTENT_MAX),
    blocks: blocks?.success ? blocks.data : null,
    tool_results: cards?.success ? cards.data : null,
    proposal_id: row.proposalId,
    created_at: row.createdAt.toISOString(),
  };
}
