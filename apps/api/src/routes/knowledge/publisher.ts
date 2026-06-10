/**
 * Publisher de `kb.document.ingest` a partir da API (F3-S04 é dono do contrato).
 *
 * Ao criar/reprocessar um documento, a API publica um envelope mínimo
 * (`{ workspaceId, documentId, reason }`) em `hm.q.kb_ingest`; o worker de
 * ingestão (F3-S03) consome, relê o doc do banco e gera os chunks/embeddings.
 *
 * Mesmo padrão lazy-channel do `outbound-publisher` (canal compartilhado por
 * processo, reconecta se cair).
 */
import {
  connectMq,
  KB_DOCUMENT_INGEST_TYPE,
  KB_INGEST_ROUTING_KEY,
  makeEnvelope,
  publish,
  type KbDocumentIngestPayload,
  type KbIngestReason,
  type MqHandle,
} from '@hm/shared/mq';

let handlePromise: Promise<MqHandle> | null = null;

async function getHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  try {
    return await handlePromise;
  } catch (err) {
    handlePromise = null;
    throw err;
  }
}

/** Publica `kb.document.ingest` para o worker de ingestão. */
export async function publishKbIngest(
  workspaceId: string,
  documentId: string,
  reason: KbIngestReason,
): Promise<boolean> {
  const { channel } = await getHandle();
  const payload: KbDocumentIngestPayload = { workspaceId, documentId, reason };
  const envelope = makeEnvelope(KB_DOCUMENT_INGEST_TYPE, workspaceId, payload);
  return publish(channel, KB_INGEST_ROUTING_KEY, envelope);
}

/** Encerra o canal/conn (testes / shutdown). */
export async function closeKbPublisher(): Promise<void> {
  if (!handlePromise) return;
  const pending = handlePromise;
  handlePromise = null;
  try {
    const { connection } = await pending;
    await connection.close();
  } catch {
    // já caiu — nada a fazer
  }
}
