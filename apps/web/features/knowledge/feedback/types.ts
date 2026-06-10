/**
 * Tipos de citação + feedback de KB (F3-S07).
 *
 * `Citation` espelha o contrato `payload.results[]` de `search_knowledge_base`
 * (F3-S05): document_id / chunk_id / title / content / score. A UI projeta esse
 * shape (snake_case do runtime) para camelCase ao montar a citação.
 */
export interface Citation {
  documentId: string;
  chunkId: string | null;
  title: string;
  content?: string;
  score?: number;
}

export interface SubmitFeedbackInput {
  documentId: string;
  chunkId?: string | null;
  agentId?: string | null;
  conversationId?: string | null;
  helpful: boolean;
  reason?: string | null;
}

/**
 * Parse defensivo do `result` de um `tool_call_completed` de search_knowledge_base
 * para uma lista de `Citation`. Tolera shape parcial (degrada para []).
 */
export function citationsFromToolResult(result: unknown): Citation[] {
  if (typeof result !== 'object' || result === null) return [];
  const payload = (result as Record<string, unknown>)['payload'];
  if (typeof payload !== 'object' || payload === null) return [];
  const results = (payload as Record<string, unknown>)['results'];
  if (!Array.isArray(results)) return [];
  const out: Citation[] = [];
  for (const item of results) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const documentId = obj['document_id'];
    const title = obj['title'];
    if (typeof documentId !== 'string' || typeof title !== 'string') continue;
    out.push({
      documentId,
      chunkId: typeof obj['chunk_id'] === 'string' ? obj['chunk_id'] : null,
      title,
      content: typeof obj['content'] === 'string' ? obj['content'] : undefined,
      score: typeof obj['score'] === 'number' ? obj['score'] : undefined,
    });
  }
  return out;
}
