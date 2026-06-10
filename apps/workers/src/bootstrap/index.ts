/**
 * Bootstrap dos workers de canal (F1-S26) — composition root.
 *
 * Liga a pipeline ponta-a-ponta:
 *
 * ```
 * connectMq() → assertTopology(channel)
 *   → createAdapterFactory (provider → IChannelAdapter)
 *   → create{Inbound,Outbound,Media}Deps (persistência DIRETA @hm/db + RLS)
 *   → start{Inbound,Outbound,Media}Worker (consumers RabbitMQ)
 * → graceful shutdown (SIGINT/SIGTERM)
 * ```
 *
 * Cada worker abre sua **própria** conexão/canal AMQP (ver `start*Worker`); o
 * canal criado aqui é usado só para `assertTopology` (idempotente) e como
 * transporte AMQP injetado nas deps (socket relay / media enqueue / flow). Como
 * `connectMq()` cria conexão+canal a cada chamada, o canal de topologia é
 * encerrado após o boot.
 */
import Redis from 'ioredis';
import { assertTopology, connectMq, type MqHandle } from '@hm/shared/mq';
import { createLogger, type Logger } from '@hm/logger';
import { createInboundDeps, startInboundWorker, type InboundWorkerHandle } from '../inbound/index';
import {
  createOutboundDeps,
  startOutboundWorker,
  type OutboundWorkerHandle,
} from '../outbound/index';
import {
  createMediaDeps,
  startMediaWorker,
  MqMediaSocketEmit,
  type MediaWorkerHandle,
} from '../media/index';
import {
  agentRuntimeConfigFromEnv,
  createAgentDeps,
  runAgentMetricsRollup,
  startAgentWorker,
  startFollowupScheduler,
  type AgentWorkerHandle,
  type FollowupSchedulerHandle,
} from '../agents/index';
import {
  createKbIngestDeps,
  startKbIngestWorker,
  type KbIngestWorkerHandle,
} from '../knowledge/index';
import {
  createFlowWorkerDeps,
  startFlowWorker,
  startFlowWakeupScheduler,
  type FlowWorkerHandle,
  type FlowSchedulerHandle,
} from '../flows/index';
import {
  createActionExecutor,
  startAutomationWorker,
  startStaleScheduler,
  type ActionPorts,
  type AutomationWorkerHandle,
} from '../automations/index';

/** Intervalo do rollup de métricas de agentes (F2-S13); idempotente. */
const METRICS_ROLLUP_INTERVAL_MS = 10 * 60_000;
import {
  adapterFactoryByChannel,
  createAdapterFactory,
  type AdapterFactoryOptions,
} from './adapter-factory';

/** Canal AMQP derivado de `@hm/shared/mq`. */
type MqChannel = MqHandle['channel'];

export interface BootstrapOptions {
  readonly logger?: Logger;
  readonly adapter?: AdapterFactoryOptions;
}

/** Handle de todos os consumers + parada limpa (ordem inversa de start). */
export interface WorkersBootstrapHandle {
  readonly inbound: InboundWorkerHandle;
  readonly outbound: OutboundWorkerHandle;
  readonly media: MediaWorkerHandle;
  readonly agent: AgentWorkerHandle;
  readonly kbIngest: KbIngestWorkerHandle;
  readonly followup: FollowupSchedulerHandle;
  readonly flow: FlowWorkerHandle;
  readonly flowScheduler: FlowSchedulerHandle;
  readonly automationWorker: AutomationWorkerHandle;
  stop(): Promise<void>;
}

/**
 * Sobe os três workers de canal (inbound/outbound/media) com persistência direta
 * e a adapter factory. Garante a topologia AMQP antes de qualquer consumer.
 *
 * Cada `start*Worker` abre a própria conexão; aqui só passamos um `channel` AMQP
 * (de uma conexão dedicada de boot) como transporte para socket relay / media
 * enqueue / flow enqueue dentro das deps.
 */
export async function startWorkers(
  options: BootstrapOptions = {},
): Promise<WorkersBootstrapHandle> {
  const logger = options.logger ?? createLogger('info', { svc: '@hm/workers' });

  // Conexão de boot: assertTopology + transporte das deps (socket/media/flow).
  const boot = await connectMq();
  await assertTopology(boot.channel);
  logger.info('topologia AMQP garantida');

  const channel: MqChannel = boot.channel;

  const adapterFactory = createAdapterFactory(options.adapter);
  const byChannel = adapterFactoryByChannel(adapterFactory);

  const inbound = await startInboundWorker({
    deps: createInboundDeps(channel, logger),
    logger,
  });

  const outbound = await startOutboundWorker({
    deps: createOutboundDeps(channel, byChannel),
    logger,
  });

  const media = await startMediaWorker({
    deps: createMediaDeps(new MqMediaSocketEmit(channel), adapterFactory),
    logger,
  });

  // Worker de agentes IA (F2-S11): consome hm.q.flows (ai_mode='on') → runtime.
  const agent = await startAgentWorker({
    deps: createAgentDeps(channel, agentRuntimeConfigFromEnv(), logger),
    logger,
  });

  // Worker de ingestão de KB (F3-S03): consome hm.q.kb_ingest → chunk+embed+persist.
  const kbIngest = await startKbIngestWorker({
    deps: createKbIngestDeps(logger),
    logger,
  });

  // Worker de execucao de flows (F4-S03): consome hm.q.flow.execution -> processFlowStep.
  const flow = await startFlowWorker({
    deps: createFlowWorkerDeps(channel, logger),
    logger,
  });

  // Scheduler singleton (Redis lock): follow-up cron (F2-S21) + rollup de métricas
  // (F2-S13, idempotente). Reusa o `channel` AMQP de boot como transporte de publish.
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  const followup = startFollowupScheduler({ redis, channel, logger });
  // Scheduler de wakeup de flows (F4-S03): re-enfileira execucoes waiting vencidas.
  const flowScheduler = startFlowWakeupScheduler({ redis, channel, logger });
  // Motor de automacoes de stage (F5-S06): drainer de pending_automations + cron
  // on_stale. As portas de action (add_tag/register_conversion/trigger_flow) sao
  // preenchidas conforme F5-S14/S16/flow-engine; actions sem porta vao a retry/failed.
  const automationPorts: ActionPorts = {};
  const automationExecutor = createActionExecutor(automationPorts);
  const automationWorker = startAutomationWorker({ redis, logger, execute: automationExecutor });
  const staleScheduler = startStaleScheduler({ redis, logger });
  const metricsTimer = setInterval(() => {
    void runAgentMetricsRollup({}, logger).catch((err: unknown) => {
      logger.error('falha no rollup de métricas de agentes', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, METRICS_ROLLUP_INTERVAL_MS);
  metricsTimer.unref();

  logger.info('workers iniciados', {
    workers: [
      'inbound',
      'outbound',
      'media',
      'agent',
      'kb-ingest',
      'followup-scheduler',
      'flow',
      'flow-wakeup-scheduler',
      'automation-worker',
      'automation-stale-scheduler',
    ],
  });

  return {
    inbound,
    outbound,
    media,
    agent,
    kbIngest,
    followup,
    flow,
    flowScheduler,
    automationWorker,
    async stop(): Promise<void> {
      // Para na ordem inversa do start; cada worker fecha sua própria conexão.
      clearInterval(metricsTimer);
      await flowScheduler.stop();
      await staleScheduler.stop();
      await automationWorker.stop();
      await flow.stop();
      followup.stop();
      await kbIngest.stop();
      await agent.stop();
      await media.stop();
      await outbound.stop();
      await inbound.stop();
      await redis.quit();
      await boot.connection.close();
      logger.info('workers parados');
    },
  };
}

/**
 * Entrypoint do processo: sobe todos os consumers e instala o graceful shutdown.
 * `dev:all`/produção invocam isto. Falha de boot derruba o processo (exit 1) —
 * o supervisor (systemd/PM2) reinicia.
 */
export async function main(): Promise<void> {
  const logger = createLogger('info', { svc: '@hm/workers' });
  const handle = await startWorkers({ logger });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('sinal de parada recebido — encerrando', { signal });
    handle
      .stop()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        logger.error('falha no shutdown', {
          error: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
      });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

export {
  createAdapterFactory,
  adapterFactoryByChannel,
  AdapterUnavailableError,
  type AdapterFactoryOptions,
} from './adapter-factory';
