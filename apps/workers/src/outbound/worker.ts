/**
 * Worker outbound — composição (LIVECHAT.md §3.1).
 *
 * ```
 * consume hm.q.outbound → parseOutboundJob (Zod)
 *   → runWithDistributedLock(`hm:lock:outbound:${conversationId}`, 90s)
 *       → resolve canal+adapter → dispatchOutbound (valida kind↔provider)
 *       → finalizeOutbound (persist + socket emit)
 *   → ack/nack
 * ```
 *
 * `consume` de `@hm/shared/mq` já valida o `Envelope`, faz `ack` em sucesso e
 * `nack(requeue=false)` se o handler lançar. Erros de *negócio* (mismatch,
 * falha do provider) NÃO lançam: viram `view_status: failed` persistido e o job
 * é ack'd (não há ganho em reprocessar um payload imutável). Só erros de
 * *infra* (lock/DB/MQ) propagam para nack → DLX.
 */
import { connectMq, consume, type Envelope, type MqHandle } from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import { runWithDistributedLock, type LockStore } from '../lock';
import { resolveOutboundLockStore } from '../redis';
import { parseOutboundJob, type OutboundJob } from './job';
import { dispatchOutbound } from './dispatch';
import { recordIgMessageTagUsed, recordIgWindowBlocked } from './ig-metrics';
import { finalizeOutbound } from './finalize';
import { runPresencePreAction } from './presence';
import {
  DbChannelResolver,
  DbOutboundPersistence,
  type ChannelAdapterFactory,
} from './db-ports';
import { MqSocketEmit } from './mq-ports';
import type { ChannelResolver, OutboundDeps, ResolvedChannel } from './ports';

/** Canal AMQP derivado de `@hm/shared/mq` (sem dep direta de `amqplib`). */
type MqChannel = MqHandle['channel'];

/** Fila canônica de outbound (topology: `QUEUES.outbound`). */
export const OUTBOUND_QUEUE = 'hm.q.outbound' as const;

/** TTL do lock por conversa (LIVECHAT.md §3.4). */
export const OUTBOUND_LOCK_TTL_MS = 90_000;

/** Chave de lock FIFO por conversa. */
export function lockKey(conversationId: string): string {
  return `hm:lock:outbound:${conversationId}`;
}

/** Prefetch default do consumer outbound (tuning F52-S10). */
export const DEFAULT_OUTBOUND_PREFETCH = 16;

/** TTL default do cache de canal+adapter por workspace (tuning F52-S10). */
export const DEFAULT_CHANNEL_CACHE_TTL_MS = 30_000;

/**
 * Lê o prefetch do consumer outbound do ambiente (`OUTBOUND_PREFETCH`).
 *
 * Com o lock por conversa (FIFO local + Redis), jobs de conversas DISTINTAS
 * podem ser processados em paralelo numa instância sem violar a ordem — então o
 * prefetch deixa de precisar ser 1. Jobs da MESMA conversa continuam
 * serializados pelo lock. Default 16.
 */
export function outboundPrefetchFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['OUTBOUND_PREFETCH'];
  if (raw === undefined || raw.length === 0) return DEFAULT_OUTBOUND_PREFETCH;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_OUTBOUND_PREFETCH;
}

/** Lê o TTL do cache de canal do ambiente (`OUTBOUND_CHANNEL_CACHE_TTL_MS`). */
export function channelCacheTtlFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['OUTBOUND_CHANNEL_CACHE_TTL_MS'];
  if (raw === undefined || raw.length === 0) return DEFAULT_CHANNEL_CACHE_TTL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CHANNEL_CACHE_TTL_MS;
}

interface CacheEntry {
  readonly promise: Promise<ResolvedChannel>;
  readonly expiresAt: number;
}

/**
 * Decorator de `ChannelResolver` com cache TTL por `workspace:channel` (tuning
 * F52-S10). Resolver o canal hoje implica consulta ao DB (RLS) + decifrar a
 * credencial + instanciar o adapter — caro para repetir a cada job. O cache
 * elimina esse round-trip nos envios subsequentes da mesma conversa/canal.
 *
 * - Cacheia a **Promise** (não só o valor) → dedupa resolves concorrentes
 *   (stampede) quando vários jobs chegam juntos.
 * - Rejeição é evictada na hora (não envenena o cache).
 * - TTL curto (default 30s) mantém a rotação de token/estado do canal fresca.
 */
export class CachingChannelResolver implements ChannelResolver {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly inner: ChannelResolver,
    private readonly ttlMs: number = DEFAULT_CHANNEL_CACHE_TTL_MS,
  ) {}

  async resolve(channelId: string, workspaceId: string): Promise<ResolvedChannel> {
    if (this.ttlMs <= 0) return this.inner.resolve(channelId, workspaceId);

    const key = `${workspaceId}:${channelId}`;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) return hit.promise;

    const promise = this.inner.resolve(channelId, workspaceId);
    this.cache.set(key, { promise, expiresAt: now + this.ttlMs });
    // Não envenena o cache com falhas.
    promise.catch(() => {
      const current = this.cache.get(key);
      if (current?.promise === promise) this.cache.delete(key);
    });
    return promise;
  }
}

export interface OutboundWorkerOptions {
  readonly deps: OutboundDeps;
  readonly logger: Logger;
  /** Backend de lock (default: FIFO em memória — ver `lock.ts`). */
  readonly lockStore?: LockStore;
}

/**
 * Monta as dependências default do worker outbound a partir da infra real
 * (F1-S26): resolver DB-backed (canal+token, RLS) com a `AdapterFactory`
 * injetada, persistência DIRETA `@hm/db`+RLS (`DbOutboundPersistence`) e socket
 * via fila de relay. O `channel` AMQP é o do consumer.
 */
export function createOutboundDeps(
  channel: MqChannel,
  adapterFactory: ChannelAdapterFactory,
): OutboundDeps {
  return {
    // Tuning F52-S10: resolve canal+adapter sob cache TTL → 1 round-trip de DB
    // por canal a cada `ttl`, em vez de a cada job.
    channels: new CachingChannelResolver(
      new DbChannelResolver(adapterFactory),
      channelCacheTtlFromEnv(),
    ),
    persistence: new DbOutboundPersistence(),
    socket: new MqSocketEmit(channel),
  };
}

/**
 * Processa um único envelope (testável sem RabbitMQ). Lança apenas em falha de
 * infra (lock/persistência) — o caller (`consume`) converte em nack.
 */
export async function handleOutboundEnvelope(
  envelope: Envelope,
  options: OutboundWorkerOptions,
): Promise<void> {
  const { deps, logger, lockStore } = options;
  const job: OutboundJob = parseOutboundJob(envelope.payload);
  const workspaceId = envelope.workspaceId;

  await runWithDistributedLock(
    lockKey(job.conversationId),
    OUTBOUND_LOCK_TTL_MS,
    async () => {
      const { channel, adapter } = await deps.channels.resolve(job.channelId, workspaceId);

      // Pre-action: dispara "digitando…" no canal antes do envio real (F1-S21).
      // Best-effort — falha aqui não bloqueia o envio.
      await runPresencePreAction(job, channel, adapter, logger);

      const dispatch = await dispatchOutbound(job, channel, adapter);

      // F15-S04: metricas IG (tag usada / janela bloqueada).
      if (dispatch.dispatched && dispatch.messageTagUsed !== undefined) {
        recordIgMessageTagUsed(dispatch.messageTagUsed);
      }
      if (!dispatch.dispatched && dispatch.windowBlocked === true) {
        recordIgWindowBlocked();
      }

      if (!dispatch.result.ok) {
        logger.warn('outbound: envio não concluído', {
          kind: job.kind,
          conversationId: job.conversationId,
          messageId: job.messageId,
          provider: channel.provider,
          dispatched: dispatch.dispatched,
          errorCode: dispatch.result.errorCode,
        });
      }

      await finalizeOutbound(job, dispatch.result, workspaceId, deps);
    },
    lockStore,
  );
}

export interface OutboundWorkerHandle {
  stop(): Promise<void>;
}

/**
 * Inicia o consumer de `hm.q.outbound`. Conecta ao RabbitMQ, garante a fila e
 * registra o handler. Retorna um handle para parada limpa.
 */
export async function startOutboundWorker(
  options: OutboundWorkerOptions,
): Promise<OutboundWorkerHandle> {
  const { logger } = options;

  // Lock store: o injetado (testes) tem prioridade; senão resolve por ambiente
  // (Redis em produção/multi-instância, in-memory em dev/teste).
  const lock = options.lockStore
    ? { store: options.lockStore, close: async (): Promise<void> => undefined }
    : resolveOutboundLockStore(logger);
  const workerOptions: OutboundWorkerOptions = { ...options, lockStore: lock.store };

  const { connection, channel } = await connectMq();
  await channel.assertQueue(OUTBOUND_QUEUE, { durable: true });
  // Tuning F52-S10: prefetch > 1 — conversas distintas correm em paralelo
  // (a ordem da MESMA conversa é mantida pelo lock por conversa).
  const prefetch = outboundPrefetchFromEnv();
  await channel.prefetch(prefetch);

  await consume(channel, OUTBOUND_QUEUE, async (envelope) => {
    await handleOutboundEnvelope(envelope, workerOptions);
  });

  logger.info('outbound worker iniciado', { queue: OUTBOUND_QUEUE, prefetch });

  return {
    async stop(): Promise<void> {
      await channel.close();
      await connection.close();
      await lock.close();
      logger.info('outbound worker parado', { queue: OUTBOUND_QUEUE });
    },
  };
}
