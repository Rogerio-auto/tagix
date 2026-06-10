/**
 * Integracao do Flow Builder no LiveChat (F4-S12). Quickbar manual + confirm + badge de
 * execucoes. Montado no ChatHeader/ChatList pelo orchestrator (gap-fill).
 */
export { ManualFlowsQuickbar } from './ManualFlowsQuickbar';
export { FlowExecutionsBadge } from './FlowExecutionsBadge';
export { TriggerConfirmModal } from './TriggerConfirmModal';
export { ExecutionDetailDrawer } from './ExecutionDetailDrawer';
export {
  useManualFlows,
  useConversationExecutions,
  useTriggerFlow,
  type ManualFlow,
  type ConversationExecution,
} from './queries';
