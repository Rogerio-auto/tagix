/**
 * Motor de propostas do Copiloto (F73-S05; ADR-004).
 *
 * Para quem registra capacidades (F73-S08/S09):
 *   - implemente `CapabilityExecutor<Args>` (`internal/copilot/core/executor-types.ts`);
 *   - exporte o executor em `executors` da sua área (`act-crm`/`act-external`);
 *   - exporte a ferramenta `makeProposeTool(executor, { description })` em `tools`.
 *
 * Para o piloto automático (F73-S13): `proposeAction(deps, { tx, principal, source: 'autopilot',
 * turnId: null, sessionId: null, preconfirmed: true }, executor, args)`.
 */
export {
  createProposal,
  makeProposeTool,
  proposeAction,
  proposeEnvelope,
  proposeToolKey,
  type ProposeContext,
  type ProposeOutcome,
  type ProposeToolOptions,
} from './propose';
export { confirmProposal, type ConfirmInput, type Confirmed } from './confirm';
export { adjustProposal, applyAdjustment, type AdjustOk } from './adjust';
export { cancelProposal, type Cancelled } from './cancel';
export { undoProposal, type Undone } from './undo';
export { retryFailedItems, type Retried } from './retry';
export {
  approvalNotification,
  listApprovers,
  notifySafely,
  requestApproval,
  type ApprovalRequested,
} from './approval';
export {
  drainProposalExecutions,
  runProposalExecution,
  savepointRunner,
  startProposalExecution,
  workspaceRunner,
  type TxRunner,
} from './execute';
export {
  PROPOSAL_SWEEP_INTERVAL_MS,
  PROPOSAL_SWEEP_LOCK_KEY,
  startProposalSweeper,
  sweepProposalsOnce,
  type ProposalSweeper,
  type SweepRedis,
} from './sweeper';
export { createExecutorRegistry, createProposalEngineDeps, relayProposalUpdate } from './deps';
export { buildProposalDTO, canViewProposal, toActivityEntry, toProposalDTO } from './dto';
export { recordProposalAudit, PROPOSAL_AUDIT_RESOURCE } from './audit';
export { publishProposalState } from './progress';
export {
  ACTIVITY_CSV_HEADER,
  activityCsvRow,
  csvCell,
  listActivityPage,
  scrubContactPii,
} from './activity';
export {
  APPROVAL_TTL_SECONDS,
  PROPOSAL_ERROR_MESSAGES,
  PROPOSAL_ERROR_STATUS,
  PROPOSAL_TTL_SECONDS,
  UNDO_WINDOW_SECONDS,
  fail,
  type ExecutorRegistry,
  type ProposalEngineDeps,
  type ProposalErrorCode,
  type ProposalFailure,
  type ProposalNotifier,
  type ProposalUpdateEmitter,
} from './types';
