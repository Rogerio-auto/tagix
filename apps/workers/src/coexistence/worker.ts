/**
 * Worker de coexistência WhatsApp Business (F39-S04) — composição.
 *
 * ```
 * consume hm.q.coexistence → valida Envelope (Zod, em `consume`)
 *   → roteia por envelope.type:
 *       coexistence.echo      → coexistenceEchoSchema      → persistEcho
 *       coexistence.history   → coexistenceHistoryBatchSchema → importHistory
 *       coexistence.app_state → coexistenceAppStateSchema  → syncAppState
 *   → ack/nack
 * ```
 *
 * `consume` de `@hm/shared/mq` valida o `Envelope`, faz `ack` em sucesso e
 * `nack(requeue=false)` se o handler lançar. Erros de **conteúdo** (payload
 * malformado, type desconhecido, canal órfão) NÃO lançam: logam-warn e ack'am
 * (reprocessar um payload imutável não ajuda). Só erros de **infra** (DB)
 * propagam para nack.
 *
 * Idempotência: cada fluxo é ancorado no id externo (`externalId`/`waId`) — ver
 * `db-ports.ts`. Reprocessar o mesmo envelope é no-op.
 */
import { connectMq, consume, QUEUES, COEXISTENCE_EVENT_TYPES, type MqHandle } from '@hm/shared/mq';
import {
  coexistenceAppStateSchema,
  coexistenceEchoSchema,
  coexistenceHistoryBatchSchema,
  type Envelope,
} from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import {
  DbCoexistencePersistence,
  MqCoexistenceSocketEmit,
  NoopCoexistenceSocketEmit,
} from './db-ports';
import { MqMediaEnqueue } from '../inbound/mq-ports';
import type { CoexistenceDeps } from './ports';
import { instagramEchoSchema } from './instagram-echo';

/** Canal AMQP derivado de `@hm/shared/mq` (sem dep direta de `amqplib`). */
type MqChannel = MqHandle['channel'];

/** Fila canônica de coexistência (`QUEUES.coexistence`). */
export const COEXISTENCE_QUEUE = QUEUES.coexistence;

export interface CoexistenceWorkerOptions {
  readonly deps: CoexistenceDeps;
  readonly logger: Logger;
}

export interface CoexistenceWorkerHandle {
  stop(): Promise<void>;
}

/**
 * Monta as dependências default a partir da infra real (persistência `@hm/db`).
 * Recebe o `channel` AMQP do composition root para empurrar `message:new`
 * (echoes) e `conversation:updated` (history) ao relay de socket — sem ele, a
 * coexistência persistia mas NÃO atualizava o LiveChat ao vivo. Quando ausente
 * (testes/sem broker), usa um emissor no-op.
 */
export function createCoexistenceDeps(logger: Logger, channel?: MqChannel): CoexistenceDeps {
  const socket = channel ? new MqCoexistenceSocketEmit(channel) : new NoopCoexistenceSocketEmit();
  // Enfileiramento de mídia: reusa o MESMO publisher/fila (`hm.q.media`) do inbound.
  // Sem canal (testes/sem broker) fica undefined → echo persiste sem enfileirar.
  const media = channel ? new MqMediaEnqueue(channel) : undefined;
  return {
    persistence: new DbCoexistencePersistence(
      logger,
      undefined,
      socket,
      media,
      ownMetaAppIdsFromEnv(process.env),
    ),
  };
}

/**
 * IDs do(s) app(s) Meta do próprio Leadium (`META_APP_ID`, aceita lista separada
 * por vírgula). Usado para descartar o eco do IG de mensagens que nós mesmos
 * enviamos pela API (F70-S04).
 */
export function ownMetaAppIdsFromEnv(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  const raw = env['META_APP_ID'] ?? '';
  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
}

/**
 * Materializa ecos do Instagram (F70-S04). Recebe os eventos produzidos por
 * `parseInstagramEchoes` (`@hm/channels`) — `unknown` porque cruzam fronteira de
 * processo — e revalida cada um com Zod. Mesmo contrato de erro do envelope:
 * conteúdo inválido loga-warn e segue; só erro de infra (DB) lança.
 */
export async function handleInstagramEchoes(
  events: readonly unknown[],
  options: CoexistenceWorkerOptions,
): Promise<void> {
  const { deps, logger } = options;
  for (const raw of events) {
    const parsed = instagramEchoSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn('coexistence: eco IG inválido — descartado');
      continue;
    }
    const result = await deps.persistence.persistInstagramEcho(parsed.data);
    logger.info('coexistence: eco IG processado', {
      igUserId: parsed.data.igUserId,
      externalId: parsed.data.externalId,
      resolved: result.resolved,
      inserted: result.inserted,
      aiPaused: result.aiPaused,
      startedByApp: result.startedByApp,
      ...(result.skipped !== undefined ? { skipped: result.skipped } : {}),
    });
  }
}

/**
 * Processa um único envelope (testável sem RabbitMQ). Lança apenas em falha de
 * infra (DB) — o caller (`consume`) converte em nack. Conteúdo inválido ou type
 * desconhecido loga-warn e retorna sem lançar.
 */
export async function handleCoexistenceEnvelope(
  envelope: Envelope,
  options: CoexistenceWorkerOptions,
): Promise<void> {
  const { deps, logger } = options;

  switch (envelope.type) {
    case COEXISTENCE_EVENT_TYPES.echo: {
      const parsed = coexistenceEchoSchema.safeParse(envelope.payload);
      if (!parsed.success) {
        logger.warn('coexistence: payload echo inválido — descartado', { envelopeId: envelope.id });
        return;
      }
      const result = await deps.persistence.persistEcho(parsed.data);
      logger.info('coexistence: echo processado', {
        phoneNumberId: parsed.data.phoneNumberId,
        externalId: parsed.data.externalId,
        resolved: result.resolved,
        inserted: result.inserted,
        aiPaused: result.aiPaused,
        startedByApp: result.startedByApp,
      });
      return;
    }
    case COEXISTENCE_EVENT_TYPES.history: {
      const parsed = coexistenceHistoryBatchSchema.safeParse(envelope.payload);
      if (!parsed.success) {
        logger.warn('coexistence: payload history inválido — descartado', {
          envelopeId: envelope.id,
        });
        return;
      }
      const result = await deps.persistence.importHistory(parsed.data);
      logger.info('coexistence: history importado', {
        phoneNumberId: parsed.data.phoneNumberId,
        resolved: result.resolved,
        contactsInserted: result.contactsInserted,
        messagesInserted: result.messagesInserted,
        messagesDeduped: result.messagesDeduped,
      });
      return;
    }
    case COEXISTENCE_EVENT_TYPES.appState: {
      const parsed = coexistenceAppStateSchema.safeParse(envelope.payload);
      if (!parsed.success) {
        logger.warn('coexistence: payload app_state inválido — descartado', {
          envelopeId: envelope.id,
        });
        return;
      }
      const result = await deps.persistence.syncAppState(parsed.data);
      logger.info('coexistence: app_state sincronizado', {
        phoneNumberId: parsed.data.phoneNumberId,
        state: parsed.data.state,
        resolved: result.resolved,
      });
      return;
    }
    default:
      // Outro tipo caiu na fila (bind `hm.q.coexistence.#`): ignora.
      logger.warn('coexistence: type desconhecido — ignorado', {
        envelopeId: envelope.id,
        type: envelope.type,
      });
      return;
  }
}

/**
 * Inicia o consumer de `hm.q.coexistence`. Conecta ao RabbitMQ, garante a fila e
 * registra o handler. Retorna um handle para parada limpa (mesmo contrato dos
 * demais `start*Worker`).
 */
export async function startCoexistenceWorker(
  options: CoexistenceWorkerOptions,
): Promise<CoexistenceWorkerHandle> {
  const { logger } = options;
  const { connection, channel } = await connectMq();
  await channel.assertQueue(COEXISTENCE_QUEUE, { durable: true });
  await channel.prefetch(8);

  await consume(channel, COEXISTENCE_QUEUE, async (envelope) => {
    await handleCoexistenceEnvelope(envelope, options);
  });

  logger.info('coexistence worker iniciado', { queue: COEXISTENCE_QUEUE });

  return {
    async stop(): Promise<void> {
      await channel.close();
      await connection.close();
      logger.info('coexistence worker parado', { queue: COEXISTENCE_QUEUE });
    },
  };
}
