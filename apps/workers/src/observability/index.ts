/**
 * Barrel de observabilidade dos workers. O orchestrator importa daqui para o
 * wire em `bootstrap/` (init Sentry + servidor de métricas no boot; flush +
 * stop no shutdown gracioso).
 */
export {
  initSentry,
  isSentryEnabled,
  captureException,
  flushSentry,
  Sentry,
} from './sentry';

export {
  startMetricsServer,
  stopMetricsServer,
  getWorkersMetricsRegistry,
  recordJobProcessed,
  recordJobRetry,
  setQueueDepth,
} from './metrics';
