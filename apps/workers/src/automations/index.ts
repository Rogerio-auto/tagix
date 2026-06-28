/**
 * Motor de automacoes de stage (F5-S06). Composition surface p/ o bootstrap:
 *   - dispatchAutomationRules / scheduleRules  (agendamento via seam onStageChanged)
 *   - startAutomationWorker / runAutomationTick (drainer de pending_automations)
 *   - startStaleScheduler / runStaleTick        (cron on_stale com guard anti-loop)
 *   - createActionExecutor / ActionPorts        (roteador de actions, DI)
 */
export {
  dispatchAutomationRules,
  scheduleRules,
} from './dispatch';
export {
  AUTOMATION_LOCK_KEY,
  DEFAULT_AUTOMATION_TICK_MS,
  MAX_ATTEMPTS,
  automationTickMsFromEnv,
  backoffMs,
  runAutomationTick,
  startAutomationWorker,
  type AutomationDeps,
  type AutomationTickResult,
  type AutomationWorkerHandle,
} from './worker';
export {
  DEFAULT_STALE_TICK_MS,
  MAX_AUTOMOVES_PER_DEAL_PER_DAY,
  STALE_LOCK_KEY,
  runStaleTick,
  startStaleScheduler,
  type StaleDeps,
  type StaleTickResult,
} from './stale';
export {
  createActionExecutor,
  MissingPortError,
  type ActionPorts,
} from './executors';
export {
  createCalendarEventPort,
  liveCreateEventPortDeps,
  type CreateEventConfig,
  type CreateEventPort,
  type CreateEventPortCtx,
  type CreateEventPortDeps,
  type DealEventRef,
  type LiveCreateEventPortOptions,
} from './create-event-port';
export type {
  ActionExecutor,
  AutomationContext,
  AutomationRule,
  AutomationTrigger,
  PendingAutomationRow,
} from './types';
