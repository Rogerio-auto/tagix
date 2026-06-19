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
import { and, eq } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import { assertTopology, connectMq, consume, QUEUES, type Envelope, type MqHandle } from '@hm/shared/mq';
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
  startReengagementScheduler,
  type AgentWorkerHandle,
  type FollowupSchedulerHandle,
  type ReengagementSchedulerHandle,
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
  createCoexistenceDeps,
  startCoexistenceWorker,
  type CoexistenceWorkerHandle,
} from '../coexistence/index';
import { startCampaignWorker, type CampaignSchedulerHandle } from '../campaigns/index';
import {
  startFollowupProcessor,
  type FollowupEvent,
  type FollowupSchedulerHandle as CampaignFollowupSchedulerHandle,
} from '../campaigns/followups';
import {
  createActionExecutor,
  startAutomationWorker,
  startStaleScheduler,
  type ActionPorts,
  type AutomationWorkerHandle,
} from '../automations/index';
import {
  createReminderPorts,
  startReminderScheduler,
} from '../calendar-reminders/index';
import {
  startDashboardMvScheduler,
  startDashboardSnapshotScheduler,
} from '../dashboard-refresh/index';
import {
  createJudgePort,
  evaluationRuntimeConfigFromEnv,
  startEvaluationScheduler,
} from '../evaluation/index';

/** Intervalo do rollup de métricas de agentes (F2-S13); idempotente. */
const METRICS_ROLLUP_INTERVAL_MS = 10 * 60_000;
import { startWebhookDispatcher } from '../webhooks/index';
import {
  initSentry,
  startMetricsServer,
  stopMetricsServer,
  flushSentry,
} from '../observability/index';
import { startPrivacyExportProcessor } from '../privacy/index';
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
  readonly reengagement: ReengagementSchedulerHandle;
  readonly flow: FlowWorkerHandle;
  readonly flowScheduler: FlowSchedulerHandle;
  readonly coexistence: CoexistenceWorkerHandle;
  readonly campaignWorker: CampaignSchedulerHandle;
  readonly followupProcessor: { handle: CampaignFollowupSchedulerHandle };
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

  // Observabilidade (F10-S01): Sentry opt-in + servidor /metrics (ambos no-op sem env).
  initSentry();
  startMetricsServer();

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

  // Worker de coexistencia WhatsApp Business (F39-S04): consome hm.q.coexistence
  // (echoes/history/app_state de F39-S03) -> materializa conversas/mensagens/
  // contatos/estado-do-canal via @hm/db+RLS, idempotente por id externo.
  const coexistence = await startCoexistenceWorker({
    deps: createCoexistenceDeps(logger),
    logger,
  });

  // Scheduler singleton (Redis lock): follow-up cron (F2-S21) + rollup de métricas
  // (F2-S13, idempotente). Reusa o `channel` AMQP de boot como transporte de publish.
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  const followup = startFollowupScheduler({ redis, channel, logger });
  // Scheduler de reengajamento da IA (F30-S06): retoma conversas em handoff ociosas
  // ou quando a janela de horário comercial reabre; idempotente via Redis lock.
  const reengagement = startReengagementScheduler({ redis, channel, logger });
  // Scheduler de wakeup de flows (F4-S03): re-enfileira execucoes waiting vencidas.
  const flowScheduler = startFlowWakeupScheduler({ redis, channel, logger });
  // Worker-campaigns (F6-S05): tick 1min que conduz o envio das campanhas RUNNING
  // (lock por campanha + dispatch idempotente + rate adaptativo + auto-pause RED).
  const campaignWorker = startCampaignWorker({ channel, redis, logger });
  // Followup processor (F6-S06): drain scheduler de scheduled_followups (duravel)
  // + consumer de hm.q.campaigns que materializa campaign.followup -> scheduled_followups.
  const followupProcessor = startFollowupProcessor({ channel, redis, logger });
  const campaignFollowupConsumer = await connectMq();
  await consume(campaignFollowupConsumer.channel, QUEUES.campaigns, async (envelope: Envelope) => {
    if (envelope.type !== 'campaign.followup') return;
    const p = envelope.payload as Partial<FollowupEvent>;
    if (!p.campaignId || !p.recipientId || !p.event) return;
    await followupProcessor.ports.scheduleFollowup({
      workspaceId: envelope.workspaceId,
      campaignId: p.campaignId,
      recipientId: p.recipientId,
      event: p.event,
    });
  });
  // Motor de automacoes de stage (F5-S06): drainer de pending_automations + cron
  // on_stale. As portas de action (add_tag/register_conversion/trigger_flow) sao
  // preenchidas conforme F5-S14/S16/flow-engine; actions sem porta vao a retry/failed.
  // Portas de automacao com backing real (F5-S06 + S14/S16). Acoes puras de DB
  // (add_tag/remove_tag/register_conversion) sao implementadas aqui sob RLS; as
  // demais (trigger_flow/send_message/notify_members/create_event) ainda nao tem
  // backing e vao a retry/failed (honesto — integracoes de canal/calendario sao
  // fase futura). dealContact resolve o contato do deal p/ tag/conversao.
  const automationPorts: ActionPorts = {
    async addTag({ workspaceId, dealId, tagId }) {
      await withWorkspace(workspaceId, async (tx) => {
        const [deal] = await tx
          .select({ contactId: schema.deals.contactId })
          .from(schema.deals)
          .where(eq(schema.deals.id, dealId))
          .limit(1);
        if (!deal) return;
        await tx
          .insert(schema.contactTags)
          .values({ contactId: deal.contactId, tagId, workspaceId })
          .onConflictDoNothing();
      });
    },
    async removeTag({ workspaceId, dealId, tagId }) {
      await withWorkspace(workspaceId, async (tx) => {
        const [deal] = await tx
          .select({ contactId: schema.deals.contactId })
          .from(schema.deals)
          .where(eq(schema.deals.id, dealId))
          .limit(1);
        if (!deal) return;
        await tx
          .delete(schema.contactTags)
          .where(
            and(
              eq(schema.contactTags.contactId, deal.contactId),
              eq(schema.contactTags.tagId, tagId),
            ),
          );
      });
    },
    async registerConversion({ workspaceId, dealId }, config) {
      await withWorkspace(workspaceId, async (tx) => {
        const [deal] = await tx
          .select({ contactId: schema.deals.contactId })
          .from(schema.deals)
          .where(eq(schema.deals.id, dealId))
          .limit(1);
        if (!deal) return;
        const [type] = await tx
          .select()
          .from(schema.conversionTypes)
          .where(
            and(
              eq(schema.conversionTypes.workspaceId, workspaceId),
              eq(schema.conversionTypes.key, config.conversionTypeKey),
            ),
          )
          .limit(1);
        if (!type) throw new Error(`conversion_type inexistente: ${config.conversionTypeKey}`);
        const valueCents =
          config.valueFrom === 'fixed' ? (config.valueCents ?? null) : null;
        try {
          await tx.insert(schema.conversionEvents).values({
            workspaceId,
            conversionTypeId: type.id,
            contactId: deal.contactId,
            dealId,
            valueCents,
            currency: type.currency,
            source: 'deal_won',
          });
        } catch (err: unknown) {
          // dedup same-day (uq_conv_events_dedup) -> idempotente.
          if (!(typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505')) {
            throw err;
          }
        }
      });
    },
  };
  const automationExecutor = createActionExecutor(automationPorts);
  const automationWorker = startAutomationWorker({ redis, logger, execute: automationExecutor });
  const staleScheduler = startStaleScheduler({ redis, logger });
  // Calendar reminders (F7-S05): cron 5min que notifica organizer + outbound
  // WhatsApp ao contato de eventos próximos (idempotente por metadata.remindersSent).
  const calendarReminders = startReminderScheduler({
    redis,
    logger,
    ports: createReminderPorts({ channel, logger }),
  });
  // Dashboard refresh (F8-S02): snapshot 5min (dashboard_snapshots) + REFRESH das
  // materialized views mv_dashboard_* 1h. Singleton via lock Redis dedicado.
  const dashboardSnapshot = startDashboardSnapshotScheduler({ redis, logger });
  const dashboardMv = startDashboardMvScheduler({ redis, logger });
  // Dispatcher de webhooks outbound (F9-S05): drena deliveries pendentes/retrying e
  // faz o POST assinado com HMAC + retry exponencial. Singleton via lock Redis.
  const webhookDispatcher = startWebhookDispatcher({ redis, logger });
  // Processor de export LGPD (F10-S02): drena data_export_jobs pendentes, reúne PII
  // sob RLS e grava o artefato via @hm/storage. Singleton via lock Redis.
  const privacyExport = startPrivacyExportProcessor({ redis, logger });
  // Worker de avaliacao pos-conversa (F29-S03): tick 5min que encontra conversas
  // encerradas sem avaliacao, chama o LLM-judge (F29-S02) e persiste a qualidade/
  // CSAT/objecoes (F29-S01). Singleton via lock Redis; reusa a config do runtime.
  const evaluationScheduler = startEvaluationScheduler({
    redis,
    logger,
    judge: createJudgePort(evaluationRuntimeConfigFromEnv()),
  });
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
      'reengagement-scheduler',
      'flow',
      'coexistence',
      'flow-wakeup-scheduler',
      'campaign-scheduler',
      'campaign-followup-processor',
      'automation-worker',
      'automation-stale-scheduler',
      'calendar-reminders-scheduler',
      'dashboard-snapshot-scheduler',
      'dashboard-mv-scheduler',
      'webhook-dispatcher',
      'privacy-export-processor',
      'evaluation-scheduler',
    ],
  });

  return {
    inbound,
    outbound,
    media,
    agent,
    kbIngest,
    followup,
    reengagement,
    flow,
    flowScheduler,
    coexistence,
    campaignWorker,
    followupProcessor,
    automationWorker,
    async stop(): Promise<void> {
      // Para na ordem inversa do start; cada worker fecha sua própria conexão.
      clearInterval(metricsTimer);
      await evaluationScheduler.stop();
      await privacyExport.stop();
      await webhookDispatcher.stop();
      await dashboardSnapshot.stop();
      await dashboardMv.stop();
      await flowScheduler.stop();
      await campaignWorker.stop();
      await followupProcessor.handle.stop();
      await campaignFollowupConsumer.connection.close();
      await calendarReminders.stop();
      await staleScheduler.stop();
      await automationWorker.stop();
      await coexistence.stop();
      await flow.stop();
      await reengagement.stop();
      followup.stop();
      await kbIngest.stop();
      await agent.stop();
      await media.stop();
      await outbound.stop();
      await inbound.stop();
      await redis.quit();
      await boot.connection.close();
      // Observabilidade (F10-S01): para o /metrics e dá flush no Sentry por último.
      await stopMetricsServer();
      await flushSentry();
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
