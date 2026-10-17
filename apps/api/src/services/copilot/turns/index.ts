/**
 * Turno do Copiloto (F73-S10): montagem do pedido, limite de taxa, SSE público, mapeamento
 * dos eventos do runtime e o orquestrador. As rotas ficam em `routes/copilot/sessions`.
 */
export {
  COPILOT_PLATFORM_DEFAULT_MODEL,
  COPILOT_TURN_POLICY,
  buildRunRequest,
  costFromUsage,
  estimateTurnCostUsd,
  loadTurnInputs,
  platformDefaultModel,
  resolveTurnModel,
  type TurnInputs,
  type TurnModel,
} from './assemble';
export { resolvePageContext, routeLabelFor, type ResolvedPageContext } from './context';
export {
  PERSISTED_CARDS_MAX,
  createEventMapper,
  publicErrorCode,
  type EventMapper,
  type MappedStep,
  type TurnAccumulator,
} from './map-events';
export {
  COPILOT_RATE_LIMITS,
  closeCopilotRateLimiter,
  createRedisCopilotRateLimiter,
  type CopilotRateDecision,
  type CopilotRateLimiter,
} from './rate-limit';
export {
  COPILOT_DEADLINE_GRACE_MS,
  COPILOT_TURN_DEADLINE_MS,
  abortActiveTurn,
  cancelTurn,
  handleAsk,
  runtimeFromEnv,
  type AskContext,
  type CopilotTurnDeps,
} from './run';
export {
  COPILOT_SSE_HEADERS,
  COPILOT_SSE_HEARTBEAT_MS,
  openCopilotSse,
  type CopilotSseWriter,
} from './sse';
export { COPILOT_SESSION_TITLE_LETTERS, sessionTitleFrom } from './title';
