/**
 * Tipos do versionamento de prompt do agente (F56-S31). Espelham o contrato da API
 * (`apps/api/src/routes/agents/versions.ts`): as colunas públicas de uma versão e o
 * payload do endpoint de diff.
 */

export const PROMPT_VERSION_STATUSES = ['draft', 'live', 'archived'] as const;
export type PromptVersionStatus = (typeof PROMPT_VERSION_STATUSES)[number];

/** Uma versão de prompt (`GET /api/agents/:id/versions` → `{ versions: PromptVersion[] }`). */
export interface PromptVersion {
  id: string;
  agentId: string;
  version: number;
  status: PromptVersionStatus;
  systemPrompt: string;
  model: string | null;
  modelParams: Record<string, unknown>;
  label: string | null;
  note: string | null;
  authorMemberId: string | null;
  rolledBackFrom: number | null;
  /** ISO string. */
  createdAt: string;
  /** ISO string ou null (enquanto draft). */
  publishedAt: string | null;
}

/** Resposta do diff (`GET /api/agents/:id/versions/diff?from=&to=`). */
export interface PromptVersionDiff {
  from: PromptVersion;
  to: PromptVersion;
}

/** Payload para criar/editar um rascunho. */
export interface DraftInput {
  systemPrompt: string;
  model?: string | null;
  label?: string | null;
  note?: string | null;
}
