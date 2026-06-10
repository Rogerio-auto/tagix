/**
 * Knowledge Base domain — RAG com pgvector (DATA_MODEL §8).
 *
 * - `kb_documents` (workspace-scoped → RLS): documento-fonte da base de conhecimento
 *   (upload/url/manual). `raw_content` é o markdown/texto original; `content_sha256`
 *   deduplica reingestões idênticas. KB é recurso **workspace-level** (não per-agente);
 *   `visible_to_agents` controla a visibilidade global na recuperação.
 * - `kb_chunks` (workspace-scoped → RLS): pedaços do documento prontos para retrieval.
 *   `embedding vector(1536)` (text-embedding-3-small) é nullable de propósito: o chunk é
 *   persistido na ingestão e o vetor pode ser preenchido num segundo passo idempotente
 *   (F3-S03). Índice HNSW cosine + FTS gin português vivem na migration custom
 *   `00NN_kb_pgvector.sql` (drizzle-kit não gera pgvector/HNSW nativamente).
 * - `kb_feedback` (workspace-scoped → RLS): sinal útil/não-útil de uma citação usada por
 *   um agente numa conversa; alimenta o re-ranking do retrieval (F3-S05/S07).
 *
 * Os nomes de tabela/coluna são CONTRATO: consumidos por asyncpg no Python (F3-S05) e
 * Drizzle no Node (F3-S03/S04). Não renomear sem migration coordenada.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { agents, conversations, members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Tipo custom pgvector `vector(N)`. drizzle-kit não gera pgvector nativamente, então
 * declaramos a coluna e deixamos a CREATE EXTENSION + índice HNSW na migration custom.
 * No nível TS o vetor trafega como `number[]` (asyncpg/pgvector serializa `'[..]'`).
 */
const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(',')}]`;
    },
    fromDriver(value: string): number[] {
      return value
        .slice(1, -1)
        .split(',')
        .filter((v) => v.length > 0)
        .map(Number);
    },
  })(name);

export const kbDocuments = pgTable(
  'kb_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** upload | url | manual. */
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    sourceMime: text('source_mime'),
    category: text('category'),
    tags: text('tags').array().notNull().default(sql`'{}'`),
    language: text('language').notNull().default('pt-BR'),
    priority: integer('priority').notNull().default(5),
    /** active | draft | archived. */
    status: text('status').notNull().default('active'),
    visibleToAgents: boolean('visible_to_agents').notNull().default(true),
    /** markdown/texto original. */
    rawContent: text('raw_content').notNull(),
    /** sha256 do conteúdo normalizado — dedup de reingestão. */
    contentSha256: text('content_sha256').notNull(),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => members.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_kb_documents_workspace_status').on(t.workspaceId, t.status),
    index('idx_kb_documents_category')
      .on(t.workspaceId, t.category)
      .where(sql`${t.category} is not null`),
    check('kb_documents_source_chk', sql`${t.source} in ('upload','url','manual')`),
    check('kb_documents_status_chk', sql`${t.status} in ('active','draft','archived')`),
  ],
);

export const kbChunks = pgTable(
  'kb_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => kbDocuments.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    contentTokens: integer('content_tokens').notNull(),
    /** text-embedding-3-small (1536). Nullable: preenchido na ingestão (F3-S03). */
    embedding: vector('embedding', 1536),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    // idx_kb_chunks_workspace, HNSW e FTS gin pt vivem na migration custom (pgvector).
    index('idx_kb_chunks_workspace').on(t.workspaceId),
    index('idx_kb_chunks_document').on(t.documentId, t.chunkIndex),
    unique('kb_chunks_document_chunk_uq').on(t.documentId, t.chunkIndex),
  ],
);

export const kbFeedback = pgTable(
  'kb_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => kbDocuments.id, { onDelete: 'cascade' }),
    chunkId: uuid('chunk_id').references(() => kbChunks.id, { onDelete: 'set null' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    /** true = útil, false = não-útil. */
    helpful: boolean('helpful').notNull(),
    reason: text('reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_kb_feedback_document').on(t.documentId, t.createdAt.desc())],
);
