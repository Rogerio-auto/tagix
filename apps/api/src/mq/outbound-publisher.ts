/**
 * Job outbound a partir da API (LIVECHAT.md §3.1/§3.2), pela outbox transacional.
 *
 * A borda da API persiste a mensagem em estado `pending` e grava o `OutboundJob` na
 * outbox NA MESMA transação (F70-S16/S21). O relay dos workers publica depois do
 * commit, com confirms, direto em `hm.q.outbound`; o worker outbound consome, valida
 * com `parseOutboundJob` (Zod) e dispara ao provider.
 *
 * Antes o job era publicado depois do commit: se o processo caísse entre os dois, ou o
 * broker recusasse, a mensagem ficava `pending` para sempre. Agora o commit da
 * mensagem e o do job são o mesmo — rollback leva os dois.
 */
import { enqueueOutbox, type DbTx } from '@hm/db';
import { makeEnvelope, queueJobOutbox, QUEUES, type OutboxMessage } from '@hm/shared/mq';

/** Tipo do envelope do job de envio (o mesmo que o worker outbound sempre recebeu). */
export const OUTBOUND_JOB_TYPE = 'outbound.job' as const;

/**
 * `OutboundJob` → mensagem da outbox em `hm.q.outbound`.
 *
 * `job` chega como registro não tipado de propósito: o módulo do job vive em
 * `apps/workers` (fora do grafo de imports da API), então a fonte da verdade do shape
 * é o `parseOutboundJob` do worker. O caller monta o shape exato.
 */
export function outboundJobOutbox(
  workspaceId: string,
  job: Readonly<Record<string, unknown>>,
): OutboxMessage {
  return queueJobOutbox(QUEUES.outbound, makeEnvelope(OUTBOUND_JOB_TYPE, workspaceId, job));
}

/**
 * Grava o `OutboundJob` na outbox, na transação `tx` do dado que o motiva (a mensagem
 * `pending`). A RLS `outbox_tenant_insert` exige que `workspaceId` seja o da transação.
 */
export async function enqueueOutboundJob(
  tx: DbTx,
  workspaceId: string,
  job: Readonly<Record<string, unknown>>,
): Promise<void> {
  await enqueueOutbox(tx, outboundJobOutbox(workspaceId, job));
}
