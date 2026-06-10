/**
 * Pipeline inbound (F1-S04 → refatorado em F1-S26, LIVECHAT.md §1/§3,
 * ARCHITECTURE.md §4.2).
 *
 * ```
 * parse(provider, raw)              → InboundEvent[]
 *   → extractRoutingHints           (phone_number_id / igUserId / session)
 *   → para cada evento com mídia: enqueue hm.q.inbound.media
 *   → persistence.persist(...)      (IN-PROCESS, @hm/db+RLS: dedup→contact→
 *                                    conversation→message→last→cache→socket
 *                                    message:new→status(S20)→flow(ai_mode))
 * ```
 *
 * **F1-S26:** a persistência é DIRETA via `@hm/db` (sem o publish fantasma
 * `inbound.persist.requested → DB-owner`). O `InboundPersistencePort` continua
 * injetável — o pipeline não conhece `@hm/db`; quem o conhece é o adapter default
 * (`DbInboundPersistence`), montado na composição (`createInboundDeps`).
 *
 * Dedup: a borda do webhook já deduplica por event-id (F1-S02) e a persistência
 * deduplica por `uq_messages_external (conversation_id, external_id)`. O pipeline
 * é idempotente — reprocessar o mesmo envelope é no-op (mensagens dedup'd não
 * reemitem `message:new`).
 *
 * Eventos de `status` (delivery/read acks) são processados pela persistência
 * (handler S20, ver `db-ports.ts`); o pipeline só os filtra para decidir o que
 * vira media job.
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

  // 2) Persiste in-process (@hm/db+RLS): dedup→contact→conversation→message→
  //    last→cache→socket(message:new)→status(S20)→flow(ai_mode='on').
  const request: PersistInboundRequest = { provider, routing, events };
  const result = await deps.persistence.persist(request);

  logger.info('inbound: pipeline processado', {
    provider,
    events: events.length,
    mediaJobs: mediaJobs.length,
    inserted: result.inserted,
    deduped: result.deduped,
    statuses: result.statuses,
    resolved: result.resolved,
  });

  return { events: events.length, mediaJobs: mediaJobs.length, persisted: true };
}
