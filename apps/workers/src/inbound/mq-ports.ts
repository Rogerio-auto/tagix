/**
 * Job de download da mídia recebida (F1-S26 → outbox em F70-S21).
 *
 * A mensagem inbound com mídia nasce `media_status = pending`; o media-worker (F1-S10)
 * baixa do provider, sobe pro storage e casa a URL pela `externalId`. O job vai para
 * `hm.q.media` pela OUTBOX, gravado por `DbInboundPersistence` na MESMA transação que
 * insere a mensagem:
 *
 * - commit grava os dois; rollback, nenhum;
 * - o relay só publica depois do commit — a corrida antiga ("media: mensagem-alvo
 *   inexistente", quando o job chegava antes da mensagem existir) deixa de ser possível
 *   por construção;
 * - mensagem deduplicada (reentrega do envelope) não regrava o job: ele já entrou com
 *   a primeira inserção.
 *
 * Antes era publicado no exchange de eventos depois do commit, com o workspace
 * `UNRESOLVED`; uma queda entre os dois deixava a mídia `pending` para sempre. O
 * envelope agora leva o workspace real (a RLS `outbox_tenant_insert` exige); o
 * media-worker não usa o campo.
 */
import { makeEnvelope, queueJobOutbox, QUEUES, type OutboxMessage } from '@hm/shared/mq';
import type { InboundMediaJob } from './ports';

/** Tipo do envelope de job de mídia inbound. */
export const INBOUND_MEDIA_TYPE = 'inbound.media.requested' as const;

/**
 * Job de mídia → mensagem da outbox (`hm.q.media`, exchange padrão). Payload no shape de
 * `parseMediaJob` (`media/job.ts`).
 */
export function inboundMediaJobOutbox(workspaceId: string, job: InboundMediaJob): OutboxMessage {
  return queueJobOutbox(
    QUEUES.media,
    makeEnvelope(INBOUND_MEDIA_TYPE, workspaceId, {
      provider: job.provider,
      externalId: job.externalId,
      mediaRef: job.mediaRef,
      routing: job.routing,
    }),
  );
}
