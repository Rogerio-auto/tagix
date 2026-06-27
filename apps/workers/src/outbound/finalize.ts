/**
 * `finalize` — persiste o resultado do envio e emite o socket
 * `message:status_changed` (LIVECHAT.md §3.1, §6).
 *
 * Mapeia `SendResult → ViewStatus`: sucesso ⇒ `sent`; falha ⇒ `failed`. A
 * persistência e o socket saem por portas injetáveis (ver `ports.ts`) — o
 * worker não toca DB/Socket.io diretamente.
 *
 * `typing_indicator` não persiste status de mensagem (não é mensagem).
 */
import type { ViewStatus } from '@hm/shared';
import type { SendResult } from '@hm/channels';
import {
  STATUS_RANK,
  defaultOrphanStatusStore,
  type OrphanStatusStore,
} from '../inbound/status';
import type { OutboundJob } from './job';
import type { OutboundDeps } from './ports';

/** Deriva o `view_status` a partir do resultado do adapter. */
export function statusFromResult(result: SendResult): ViewStatus {
  return result.ok ? 'sent' : 'failed';
}

/**
 * Persiste o estado da mensagem e emite o socket de mudança de status.
 * Best-effort no socket: uma falha de emissão não derruba o ack do job (o
 * status já foi persistido e a UI reidrata via REST).
 */
export async function finalizeOutbound(
  job: OutboundJob,
  result: SendResult,
  workspaceId: string,
  deps: OutboundDeps,
  orphanStore: OrphanStatusStore = defaultOrphanStatusStore,
): Promise<void> {
  if (job.kind === 'typing_indicator') return;

  const status = statusFromResult(result);

  await deps.persistence.persist({
    workspaceId,
    conversationId: job.conversationId,
    messageId: job.messageId,
    status,
    ...(result.ok ? { externalId: result.externalId } : {}),
    ...(!result.ok ? { errorCode: result.errorCode, errorMessage: result.errorMessage } : {}),
    job,
  });

  await deps.socket.emitStatusChanged({
    workspaceId,
    conversationId: job.conversationId,
    messageId: job.messageId,
    status,
  });

  // F52-S04 — reconciliação de callback tardio: agora que o external_id está
  // persistido, drena qualquer status que tenha chegado ANTES (órfão). Tira a
  // mensagem de `pending`/`sent` mesmo quando o ack da Meta correu na frente do
  // dispatch. Só aplica se avança rank (monotônico).
  if (result.ok && result.externalId !== undefined && result.externalId !== '') {
    const orphan = await orphanStore.drain(result.externalId);
    if (orphan !== null && STATUS_RANK[orphan.status] > STATUS_RANK[status]) {
      await deps.persistence.persist({
        workspaceId,
        conversationId: job.conversationId,
        messageId: job.messageId,
        status: orphan.status,
        externalId: result.externalId,
        job,
      });
      await deps.socket.emitStatusChanged({
        workspaceId,
        conversationId: job.conversationId,
        messageId: job.messageId,
        status: orphan.status,
      });
    }
  }
}
