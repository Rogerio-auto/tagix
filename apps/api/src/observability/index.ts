/**
 * Barrel de observabilidade da API. O orchestrator importa daqui para o wire em
 * `app.ts`/`server.ts` (init Sentry no boot, middlewares de métricas/erro).
 */
export {
  initSentry,
  isSentryEnabled,
  captureException,
  sentryErrorHandler,
  Sentry,
} from './sentry';

export { metricsMiddleware, metricsHandler, getMetricsRegistry } from '../middlewares/metrics';

export { recordMqPublish, recordChannelSend, recordAgentRun } from './domain-metrics';

export {
  recordCopilotTurn,
  recordCopilotTtfb,
  recordCopilotRejection,
  recordCopilotRuntimeUnavailable,
  copilotRanStatus,
  recordCopilotToolCall,
  recordCopilotProposal,
  recordCopilotCost,
  normalizeToolKey,
  COPILOT_TURN_METRIC_STATUSES,
  type CopilotTurnMetricStatus,
  type CopilotRanTurnStatus,
} from './copilot-metrics';
