/**
 * Barrel do worker de agentes (F2-S11) + entrypoint para o bootstrap (F1-S26).
 *
 * Expõe `startAgentWorker` (consumer de `hm.q.flows` → `runAgent`) e a composição
 * default das deps (`createAgentDeps`), além das portas/tipos para teste e wiring.
 * O composition root (`apps/workers/src/bootstrap/index.ts`, de F1-S26) deve
 * chamar `startAgentWorker` — ver REPORT para a linha exata e os env vars.
 *
 * Re-exporta também o roll-up de métricas (`runAgentMetricsRollup`, F2-S13) que
 * já vive neste diretório; o agendamento dele é concern separado (scheduler).
 */

export {
  // Worker (consumer hm.q.flows → runAgent).
  startAgentWorker,
  handleAgentEnvelope,
  createAgentDeps,
  agentRuntimeConfigFromEnv,
  agentRunTriggerSchema,
  MqAgentRunSocketEmit,
  MqAgentOutboundEnqueue,
  AGENT_QUEUE,
  OUTBOUND_QUEUE,
  AGENT_RUN_TYPE,
  OUTBOUND_JOB_TYPE,
  SOCKET_RELAY_QUEUE,
  type AgentRunTrigger,
  type AgentWorkerOptions,
  type AgentWorkerHandle,
  type AgentRuntimeConfig,
} from './worker';

export {
  // Orquestração de um run + portas/tipos (injeção p/ teste).
  runAgent,
  DbAgentRunStore,
  HISTORY_LIMIT,
  type AgentRunDeps,
  type AgentRunStore,
  type AgentRunContext,
  type AgentRunOutcome,
  type AgentRunSocketPort,
  type AgentExecutionEmit,
  type AgentOutboundEnqueuePort,
  type AgentOutboundEnqueueInput,
  type StartExecutionInput,
  type CompleteExecutionInput,
  type FailExecutionInput,
  type PersistAgentMessageInput,
} from './run';

// Roll-up de métricas (F2-S13) — co-localizado; agendamento é concern à parte.
export {
  runAgentMetricsRollup,
  DEFAULT_PERIODS,
  type MetricsPeriod,
  type AgentMetricsRollupOptions,
  type AgentMetricsRollupResult,
} from './metrics';
