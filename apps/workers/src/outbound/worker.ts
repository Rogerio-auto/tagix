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
 * roteia a exceção do handler pela ladder durável (retry por dead-letter + TTL)
 * → DLQ (F56-S12).
 *
 * ## Contrato de erro (F56-S14)
 *
 * - **Permanente** (mismatch kind↔provider, janela IG fechada, número inválido,
 *   template reprovado): NÃO lança — vira `view_status: failed` persistido e o
 *   job é ack'd. Reprocessar um payload imutável não muda o desfecho.
 * - **Transitório do provider** (429/5xx/timeout/rate limit): lança
 *   `TransientSendError` → a ladder durável (5s→30s→2m→10m→30m) reprocessa o
 *   job. Sobrevive a restart do worker. Esgotadas as tentativas, a mensagem vira
 *   `failed` (visível) em vez de morrer `pending` na DLQ. Ver `retry-policy.ts`.
 * - **Infra** (lock/DB/MQ): propaga como está → ladder genérica → DLQ.
 */
import { connectMq, consume, type Envelope, type MqHandle } from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import { runWithDistributedLock, type LockStore } from '../lock';
import { resolveOutboundLockStore } from '../redis';
import { parseOutboundJob, type OutboundJob } from './job';
import { dispatchOutbound, type DispatchResult } from './dispatch';
import { createConsentGate } from './consent-gate';
import { purposeOf } from './job';
import type { ConsentGatePort } from './ports';
import { recordIgMessageTagUsed, recordIgWindowBlocked } from './ig-metrics';
import { recordOutboundDenied } from './consent-metrics';
import { finalizeOutbound } from './finalize';
import { runPresencePreAction } from './presence';
import {
  DbChannelResolver,
  DbOutboundPersistence,
  defaultOutboundSendGuard,
  defaultSendAttemptStore,
  type ChannelAdapterFactory,
  type OutboundSendGuard,
} from './db-ports';
import {
  handleTransientSendFailure,
  transientFailureFromError,
  transientFailureFromResult,
  type SendAttemptStore,
} from './retry-policy';
import { MqSocketEmit } from './mq-ports';
import type { ChannelResolver, OutboundDeps, ResolvedChannel } from './ports';

/** Canal AMQP derivado de `@hm/shared/mq` (sem dep direta de `amqplib`). */
type MqChannel = MqHandle['channel'];

/** Fila canônica de outbound (topology: `QUEUES.outbound`). */
export const OUTBOUND_QUEUE = 'hm.q.outbound' as const;

/** TTL do lock por conversa (LIVECHAT.md §3.4). */
export const OUTBOUND_LOCK_TTL_MS = 90_000;

/**
 * Portão real, criado sob demanda. Preguiçoso porque `createConsentGate` toca o
 * pool do banco, e o módulo é importado também por testes que não têm banco.
 */
let consentGateSingleton: ConsentGatePort | null = null;
const defaultConsentGate: ConsentGatePort = {
  async check(input) {
    consentGateSingleton ??= createConsentGate();
    return consentGateSingleton.check(input);
  },
};

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
  /**
   * Contador durável de tentativas de envio (F56-S14). Default:
   * `DbSendAttemptStore` (`messages.metadata.sendAttempts`).
   */
  readonly attempts?: SendAttemptStore;
  /**
   * Guard de idempotência (F52-S04). Default: `DbOutboundSendGuard`. Injetável
   * porque é ele que impede o REENVIO (F56-S14) de duplicar uma mensagem que o
   * provider chegou a aceitar antes de a conexão cair.
   */
  readonly sendGuard?: OutboundSendGuard;
  /**
   * Portão de consentimento (F59-S05). Default: `createConsentGate()` — o real,
   * apoiado no banco. Injetável para teste.
   *
   * Não há caminho que pule o portão: se esta opção vier ausente, o default é o
   * portão REAL, não o permissivo. `allowAllConsentGate` existe só em teste e o
   * nome diz isso.
   */
  readonly consentGate?: ConsentGatePort;
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
 * Processa um único envelope (testável sem RabbitMQ).
 *
 * Lança em (a) falha de infra (lock/DB/resolve de canal) e (b) falha TRANSITÓRIA
 * do provider ainda com orçamento de tentativas (`TransientSendError`) — nos dois
 * casos o `consume` roteia pela ladder durável. Falha permanente e transitória
 * esgotada NÃO lançam: viram `failed` persistido (visível) + ack.
 */
export async function handleOutboundEnvelope(
  envelope: Envelope,
  options: OutboundWorkerOptions,
): Promise<void> {
  const { deps, logger, lockStore } = options;
  const attempts = options.attempts ?? defaultSendAttemptStore;
  const sendGuard = options.sendGuard ?? defaultOutboundSendGuard;
  const consentGate = options.consentGate ?? defaultConsentGate;
  const job: OutboundJob = parseOutboundJob(envelope.payload);
  const workspaceId = envelope.workspaceId;

  await runWithDistributedLock(
    lockKey(job.conversationId),
    OUTBOUND_LOCK_TTL_MS,
    async () => {
      const { channel, adapter } = await deps.channels.resolve(job.channelId, workspaceId);

      // F59-S05: portão de consentimento. Última linha de defesa antes do
      // provider — nenhum caminho de envio chega ao adapter sem passar por aqui.
      //
      // `typing_indicator` é presença, não mensagem: não carrega conteúdo, não
      // é marketing e bloqueá-lo só degradaria a UX sem ganho de conformidade.
      if (job.kind !== 'typing_indicator') {
        const decision = await consentGate.check({
          workspaceId,
          conversationId: job.conversationId,
          provider: channel.provider,
          purpose: purposeOf(job),
        });

        if (!decision.allowed) {
          recordOutboundDenied(decision.reason, channel.provider);
          // Recusa NUNCA é silenciosa: vira status visível + log estruturado.
          // O pior resultado possível seria o cliente achar que disparou.
          logger.warn('outbound: envio recusado pelo portão de consentimento', {
            kind: job.kind,
            conversationId: job.conversationId,
            messageId: job.messageId,
            provider: channel.provider,
            purpose: purposeOf(job),
            reason: decision.reason,
            timezone: decision.timezone,
            usedFallbackTimezone: decision.usedFallbackTimezone,
            retryAt: decision.retryAt?.toISOString(),
          });
          await finalizeOutbound(
            job,
            { ok: false, errorCode: `consent_${decision.reason}`, errorMessage: decision.message },
            workspaceId,
            deps,
          );
          return;
        }
      }

      // Pre-action: dispara "digitando…" no canal antes do envio real (F1-S21).
      // Best-effort — falha aqui não bloqueia o envio.
      await runPresencePreAction(job, channel, adapter, logger);

      let dispatch: DispatchResult;
      try {
        dispatch = await dispatchOutbound(job, channel, adapter, sendGuard);
      } catch (err: unknown) {
        // F56-S14: o adapter lança em falha transitória do provider (429/5xx/
        // timeout). Não é resultado de envio — é "ainda não": reprocessa pela
        // ladder durável em vez de queimar a mensagem em `failed`.
        const failure = transientFailureFromError(err, channel.provider);
        if (failure === null) throw err; // infra/bug → ladder genérica + DLQ.
        await handleTransientSendFailure({
          job,
          workspaceId,
          provider: channel.provider,
          failure,
          deps,
          logger,
          attempts,
        });
        return;
      }

      // F15-S04: metricas IG (tag usada / janela bloqueada).
      if (dispatch.dispatched && dispatch.messageTagUsed !== undefined) {
        recordIgMessageTagUsed(dispatch.messageTagUsed);
      }
      if (!dispatch.dispatched && dispatch.windowBlocked === true) {
        recordIgWindowBlocked();
      }

      if (!dispatch.result.ok) {
        // Adapters que ainda reportam falha transitória por RESULTADO (IG/WAHA):
        // mesma política, sem duplicar a taxonomia.
        const failure = transientFailureFromResult(dispatch.result);
        if (failure !== null) {
          await handleTransientSendFailure({
            job,
            workspaceId,
            provider: channel.provider,
            failure,
            deps,
            logger,
            attempts,
          });
          return;
        }

        logger.warn('outbound: envio não concluído (falha permanente)', {
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

  // `retry` fica no default da fila: `hm.q.outbound` é `reliableQueue` (F56-S12)
  // → ladder durável + DLQ. O logger torna cada agendamento de retry / dead-letter
  // observável (F56-S14: um envio que fica 40 min em retry não pode ser silencioso).
  await consume(
    channel,
    OUTBOUND_QUEUE,
    async (envelope) => {
      await handleOutboundEnvelope(envelope, workerOptions);
    },
    { logger },
  );

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
