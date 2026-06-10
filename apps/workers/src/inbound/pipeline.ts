/**
 * Pipeline inbound (F1-S04, LIVECHAT.md §1/§3) — parte que NÃO precisa de DB.
 *
 * ```
 * parse(provider, raw)              → InboundEvent[]
 *   → extractRoutingHints           (phone_number_id / igUserId / session)
 *   → para cada evento com mídia: enqueue hm.q.inbound.media
 *   → publish inbound.persist.requested  (DB-owner faz dedup→contact→conversation
 *                                         →persist→last→cache→socket→agent/flow)
 * ```
 *
 * Dedup: a borda do webhook já deduplica por event-id (F1-S02) e o DB-owner
 * deduplica por `uq_messages_external` (conversation_id, external_id). O worker
 * é puramente estrutural e idempotente — reprocessar o mesmo envelope produz a
 * mesma requisição de persist (que o DB-owner trata como no-op).
 *
 * Eventos de `status` (delivery/read acks) e demais tipos não-mensagem também
 * são repassados ao DB-owner (que atualiza `view_status` / dispara reações); o
 * worker só os filtra para decidir o que vira media job.
 */
import type { InboundEvent } from '@hm/channels';
import type { Logger } from '@hm/logger';
import { extractRoutingHints } from './parse';
import type {
  InboundDeps,
  InboundMediaJob,
  PersistInboundRequest,
  RoutingHints,
} from './ports';
import type { ChannelProvider } from '@hm/shared';

/** Resultado do pipeline (observável em teste/log). */
export interface InboundPipelineResult {
  readonly events: number;
  readonly mediaJobs: number;
  /** `false` quando não há nada a persistir (ex.: IG placeholder, raw vazio). */
  readonly persisted: boolean;
}

/** Eventos `message` que carregam mídia a baixar. */
function mediaJobsFromEvents(
  provider: ChannelProvider,
  routing: RoutingHints,
  events: readonly InboundEvent[],
): InboundMediaJob[] {
  const jobs: InboundMediaJob[] = [];
  for (const event of events) {
    if (event.type !== 'message') continue;
    if (event.mediaRef === undefined) continue;
    jobs.push({
      provider,
      externalId: event.externalId,
      mediaRef: event.mediaRef,
      routing,
    });
  }
  return jobs;
}

/**
 * Executa a parte sem-DB do pipeline para um payload de provider já parseável.
 * Testável sem RabbitMQ: todas as saídas (media/persist) são portas injetáveis.
 *
 * Lança apenas em falha de **infra** (publish/enqueue) — o caller (`consume`)
 * converte em nack→DLX. Payload vazio/sem eventos NÃO lança (ack silencioso).
 */
export async function runInboundPipeline(
  provider: ChannelProvider,
  raw: unknown,
  deps: InboundDeps,
  logger: Logger,
): Promise<InboundPipelineResult> {
  const events = deps.parser.parse(provider, raw);

  if (events.length === 0) {
    // IG placeholder, evento não-suportado, ou raw sem mensagens: nada a fazer.
    return { events: 0, mediaJobs: 0, persisted: false };
  }

  const routing = extractRoutingHints(provider, raw);

  // 1) Enfileira mídia (a MediaRef vem do raw — não depende de DB).
  const mediaJobs = mediaJobsFromEvents(provider, routing, events);
  for (const job of mediaJobs) {
    await deps.media.enqueue(job);
  }

  // 2) Publica a requisição de persistência (DB-owner aplica o resto do pipeline).
  const request: PersistInboundRequest = { provider, routing, events };
  await deps.persistence.persist(request);

  logger.info('inbound: pipeline processado', {
    provider,
    events: events.length,
    mediaJobs: mediaJobs.length,
    hasRouting:
      routing.phoneNumberId !== undefined ||
      routing.igUserId !== undefined ||
      routing.wahaSession !== undefined,
  });

  return { events: events.length, mediaJobs: mediaJobs.length, persisted: true };
}
