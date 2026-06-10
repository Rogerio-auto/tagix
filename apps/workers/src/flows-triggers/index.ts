/**
 * Trigger dispatcher inbound (F4-S13). Avalia/dispara flows e retoma execucoes waiting a
 * partir de mensagens inbound. Composto pelo pipeline inbound (gap-fill do orchestrator).
 */
export {
  INBOUND_TRIGGER_TYPES,
  DEFERRED_TRIGGER_TYPES,
  evaluateTrigger,
  resumeWaitingFlows,
  dispatchTriggersForNewMessage,
  dispatchDeferredTrigger,
  dispatchTriggersForStageChange,
  dispatchTriggersForTagAdded,
  matchesStageChange,
  matchesTagAdded,
  type TriggerDispatchDeps,
  type DispatchResult,
  type StageChangeInfo,
  type TagAddedInfo,
} from './dispatcher';
export { createTriggerDispatchDeps, flowsQueryPort, flowEnginePort } from './db-ports';
export type { ActiveFlow, FlowEnginePort, FlowsQueryPort, InboundMessageInfo } from './types';
