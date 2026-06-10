/**
 * Tipos da feature Knowledge Base (F3-S06). Espelham o contrato da API de F3-S04
 * (`apps/api/src/routes/knowledge`). Os nomes de campo são snake->camel conforme
 * a API serializa (camelCase no JSON, igual aos demais recursos).
 */

/** Lifecycle do documento (DATA_MODEL §8.1). `draft` = criado, aguardando indexação. */
export type KbDocumentStatus = 'active' | 'draft' | 'archived';
export type KbDocumentSource = 'upload' | 'url' | 'manual';

export interface KbDocument {
  id: string;
  workspaceId: string;
  title: string;
  source: KbDocumentSource;
  sourceUrl: string | null;
  category: string | null;
  tags: string[];
  language: string;
  priority: number;
  status: KbDocumentStatus;
  visibleToAgents: boolean;
  version: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface KbChunkPreview {
  id: string;
  chunkIndex: number;
  content: string;
  contentTokens: number;
}

export interface KbDocumentDetail {
  document: KbDocument;
  chunks: KbChunkPreview[];
  chunkCount: number;
}

export interface KbDocumentListResponse {
  documents: KbDocument[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateKbDocumentInput {
  title: string;
  source?: KbDocumentSource;
  category?: string | null;
  tags?: string[];
  priority?: number;
  visibleToAgents?: boolean;
  rawContent: string;
}

export interface UpdateKbDocumentInput {
  title?: string;
  category?: string | null;
  tags?: string[];
  priority?: number;
  status?: KbDocumentStatus;
  visibleToAgents?: boolean;
}

export interface KbListFilters {
  status?: KbDocumentStatus;
  category?: string;
  q?: string;
}
