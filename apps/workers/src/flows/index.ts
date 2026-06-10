/**
 * Runtime de flows (F4-S03): consumer de `hm.q.flow.execution` + scheduler de wakeup.
 * Composto pelo bootstrap dos workers.
 */
export {
  FLOW_EXECUTION_QUEUE,
  createFlowWorkerDeps,
  handleFlowExecutionEnvelope,
  startFlowWorker,
  type FlowWorkerDeps,
  type FlowWorkerHandle,
  type FlowWorkerOptions,
} from './worker';
export {
  DEFAULT_FLOW_TICK_MS,
  FLOW_SCHEDULER_LOCK_KEY,
  acquireSchedulerLock,
  flowTickMsFromEnv,
  runFlowWakeupTick,
  startFlowWakeupScheduler,
  type FlowSchedulerDeps,
  type FlowSchedulerHandle,
  type FlowSchedulerOptions,
  type FlowTickOptions,
  type FlowTickResult,
} from './scheduler';
