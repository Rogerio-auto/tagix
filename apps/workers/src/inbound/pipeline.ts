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
import { normalizeIgEvents } from './instagram-inbound';
import { recordIgMessageReceived } from './ig-metrics';
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
  const rawEvents = deps.parser.parse(provider, raw);

  // F15-S03: para Instagram, normaliza variantes (story/share/postback/referral)
  // em eventos `message` — assim o media-enqueue e a persistencia reusam o
  // caminho do WhatsApp. Comments seguem como evento `comment` (persistidos a
  // parte em ig_comments + comment_thread).
  const events =
    provider === 'meta_instagram'
      ? (() => {
          const { messageEvents, commentEvents } = normalizeIgEvents(rawEvents);
          // status/reaction originais sao preservados (persist os trata).
          const passthrough = rawEvents.filter(
            (e) => e.type === 'status' || e.type === 'reaction',
          );
          for (const m of messageEvents) recordIgMessageReceived(m.messageType);
          for (let i = 0; i < commentEvents.length; i += 1) recordIgMessageReceived('comment');
          return [...messageEvents, ...commentEvents, ...passthrough];
        })()
      : rawEvents;

  if (events.length === 0) {
    // Evento não-suportado, ou raw sem mensagens: nada a fazer.
    // Log de diagnóstico: distingue "parser não extraiu eventos" de "persist falhou".
    logger.info('inbound: pipeline sem eventos (nada a persistir)', {
      provider,
      rawEvents: rawEvents.length,
    });
    return { events: 0, mediaJobs: 0, persisted: false };
  }

  const routing = extractRoutingHints(provider, raw);

  // 1) Persiste in-process PRIMEIRO (@hm/db+RLS): dedup→contact→conversation→message→
  //    last→cache→socket(message:new)→status(S20)→flow(ai_mode='on').
  //    ORDEM CRÍTICA: a mensagem precisa EXISTIR (commitada) antes da mídia ser
  //    enfileirada. O media-worker casa a `media_url` por `external_id`; enfileirar
  //    ANTES criava uma corrida — o worker pegava o job na hora e descartava
  //    ("media: mensagem-alvo inexistente") porque a mensagem ainda não fora
  //    inserida → media_url ficava null pra sempre ("carregando áudio").
  const request: PersistInboundRequest = { provider, routing, events };
  const result = await deps.persistence.persist(request);

  // 2) Só ENTÃO enfileira a mídia (a MediaRef vem do raw; a mensagem já está
  //    commitada → o worker acha o alvo e casa a URL).
  const mediaJobs = mediaJobsFromEvents(provider, routing, events);
  for (const job of mediaJobs) {
    await deps.media.enqueue(job);
  }

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
