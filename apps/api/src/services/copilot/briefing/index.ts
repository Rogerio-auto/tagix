/**
 * Briefing do dia do Copiloto (F73-S12). Ponto de entrada do serviço.
 */
export {
  getOrCreateToday,
  localDateOf,
  localMinutesOf,
  parseStoredItems,
  publicItems,
  type BriefingOptions,
  type TodayBriefing,
} from './generate';
export { compose, scoreAll, compareScored, toPublicItem, type ComposedBriefing } from './compose';
export { BRIEFING_SCORE_VERSION, BRIEFING_WEIGHTS, scoreItem, type ScoreBreakdown } from './score';
export { needsRevalidation, revalidate, isStale, type RevalidationResult } from './freshness';
export {
  registerBriefingSource,
  type BriefingSourceProvider,
  type StoredRef,
} from './sources';
export {
  createBriefingSchedulerDeps,
  runBriefingTick,
  startBriefingScheduler,
  BRIEFING_DONE_PREFIX,
  BRIEFING_LOCK_PREFIX,
  type BriefingRedis,
  type BriefingScheduler,
  type BriefingSchedulerDeps,
  type TickResult,
} from './scheduler';
export { relayBriefingReady, type BriefingReadyEmitter } from './emit';
export * from './types';
