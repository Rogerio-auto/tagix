/**
 * Persistência da ingestão de KB (F3-S03) — DIRETO via `@hm/db` + RLS.
 *
 * Workers não importam de `apps/api`; a persistência roda sob `withWorkspace`
 * (transação com `app.workspace_id`, papel `hm_app` sujeito a RLS). A porta
 * `KbIngestStore` é injetável para teste sem DB real.
 *
 * Idempotência: `replaceChunks` apaga todos os `kb_chunks` do documento e
 * reinsere os novos numa ÚNICA transação — reprocesso/re-delivery RabbitMQ não
 * duplica. `markActive` promove o doc para `active` ao final.
 */
import { eq } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import type { DocumentChunk } from './chunker';

/** Snapshot mínimo do documento lido para ingestão. */
export interface KbDocumentSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly rawContent: string;
}

/** Chunk pronto para persistir (com o vetor já gerado). */
export interface EmbeddedChunk extends DocumentChunk {
  readonly embedding: number[];
}

export interface KbIngestStore {
  loadDocument(workspaceId: string, documentId: string): Promise<KbDocumentSnapshot | null>;
  replaceChunks(workspaceId: string, documentId: string, chunks: EmbeddedChunk[]): Promise<void>;
  markActive(workspaceId: string, documentId: string): Promise<void>;
}

/** Implementação Drizzle + RLS. */
export class DbKbIngestStore implements KbIngestStore {
  async loadDocument(
    workspaceId: string,
    documentId: string,
  ): Promise<KbDocumentSnapshot | null> {
    return withWorkspace(workspaceId, async (tx) => {
      const [doc] = await tx
        .select({
          id: schema.kbDocuments.id,
          workspaceId: schema.kbDocuments.workspaceId,
          rawContent: schema.kbDocuments.rawContent,
        })
        .from(schema.kbDocuments)
        .where(eq(schema.kbDocuments.id, documentId))
        .limit(1);
      return doc ?? null;
    });
  }

  async replaceChunks(
    workspaceId: string,
    documentId: string,
    chunks: EmbeddedChunk[],
  ): Promise<void> {
    await withWorkspace(workspaceId, async (tx) => {
      // Idempotência: limpa os chunks existentes antes de reinserir.
      await tx.delete(schema.kbChunks).where(eq(schema.kbChunks.documentId, documentId));
      if (chunks.length === 0) return;
      await tx.insert(schema.kbChunks).values(
        chunks.map((c) => ({
          workspaceId,
          documentId,
          chunkIndex: c.chunkIndex,
          content: c.content,
          contentTokens: c.contentTokens,
          embedding: c.embedding,
          metadata: c.metadata,
        })),
      );
    });
  }

  async markActive(workspaceId: string, documentId: string): Promise<void> {
    await withWorkspace(workspaceId, async (tx) => {
      await tx
        .update(schema.kbDocuments)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(schema.kbDocuments.id, documentId));
    });
  }
}
