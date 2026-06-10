/**
 * Contrato da fila de ingestão da Knowledge Base (F3-S04 é dono; F3-S03 consome).
 *
 * A API publica `kb.document.ingest` ao criar/reprocessar um documento; o worker de
 * ingestão (F3-S03) consome, relê o doc do banco (o envelope é mínimo de propósito),
 * faz chunking + embeddings e persiste `kb_chunks`.
 *
 * Routing key bind: `hm.q.kb_ingest.#` (ver `assertTopology`). Publicamos com
 * `hm.q.kb_ingest.document` via `publish(channel, KB_INGEST_ROUTING_KEY, envelope)`.
 */
import { z } from 'zod';
import { QUEUES } from './topology';

/** `type` do envelope (campo `type` do Envelope padrão). */
export const KB_DOCUMENT_INGEST_TYPE = 'kb.document.ingest' as const;

/** Routing key de publicação (bind da fila `hm.q.kb_ingest`). */
export const KB_INGEST_ROUTING_KEY = `${QUEUES.kbIngest}.document` as const;

/** Motivo da ingestão — distingue criação de reprocessamento manual. */
export const KB_INGEST_REASONS = ['create', 'reprocess'] as const;
export type KbIngestReason = (typeof KB_INGEST_REASONS)[number];

/**
 * Payload do envelope `kb.document.ingest`. Mínimo: o worker relê o documento
 * (`raw_content`, metadados) do banco a partir de `documentId` sob RLS do workspace.
 */
export const kbDocumentIngestPayloadSchema = z.object({
  workspaceId: z.string().uuid(),
  documentId: z.string().uuid(),
  reason: z.enum(KB_INGEST_REASONS),
});

export type KbDocumentIngestPayload = z.infer<typeof kbDocumentIngestPayloadSchema>;

/** Valida e estreita o payload de um envelope `kb.document.ingest` (consumo, F3-S03). */
export function parseKbDocumentIngest(payload: unknown): KbDocumentIngestPayload {
  return kbDocumentIngestPayloadSchema.parse(payload);
}
