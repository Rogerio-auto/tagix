/**
 * Repos do Copiloto (F73-S01). Toda função recebe o `tx` de `withWorkspace` (RLS por workspace),
 * exceto as varreduras `listExpiredOpen`/`listStaleExecuting`, que o agendador roda no papel
 * owner entre workspaces.
 */
export {
  copilotSettingsRepo,
  copilotMemberPrefsRepo,
  COPILOT_SETTINGS_DEFAULTS,
  COPILOT_MEMBER_PREFS_DEFAULTS,
  type CopilotSettingsValues,
  type CopilotSettingsView,
  type CopilotMemberPrefsValues,
  type CopilotMemberPrefsView,
} from './settings';
export {
  copilotSessionsRepo,
  copilotMessagesRepo,
  COPILOT_SESSIONS_PAGE_MAX,
  COPILOT_MESSAGES_PAGE_MAX,
  COPILOT_PROMPT_HISTORY_MAX,
  type CreateCopilotSessionInput,
  type AppendCopilotMessageInput,
} from './sessions';
export {
  copilotTurnsRepo,
  copilotToolCallsRepo,
  type ClaimedToolCall,
  type CreateRunningTurnInput,
  type CopilotTurnUsage,
  type InsertCopilotToolCallInput,
} from './turns';
export {
  copilotProposalsRepo,
  COPILOT_ACTIVITY_PAGE_MAX,
  COPILOT_OPEN_PROPOSAL_STATUSES,
  COPILOT_PROPOSAL_LEASE_SECONDS,
  type CopilotActionItemPatch,
  type CopilotActivityEntry,
  type CopilotItemCounts,
  type CopilotProposalPatch,
  type CopilotProposalWithItems,
  type InsertCopilotActionItem,
  type InsertCopilotProposal,
} from './proposals';
export {
  copilotMemoryRepo,
  COPILOT_PROMPT_FACTS_MAX,
  COPILOT_PROMPT_FACTS_CHARS_MAX,
  COPILOT_FACTS_PAGE_MAX,
  type CopilotPromptMemory,
} from './memory';
export { copilotBriefingsRepo, type IsoDate } from './briefings';
export {
  copilotAutopilotRepo,
  COPILOT_SUGGESTIONS_PAGE_MAX,
  type InsertCopilotSuggestionInput,
} from './autopilot';
export {
  dealIdleDaysSql,
  dealLastInboundAtSql,
  dealLastMessageDirectionSql,
  type DealIdleColumns,
  type DealLastMessageDirection,
} from './idle';
export {
  InvalidCursorError,
  encodeCursor,
  decodeCursor,
  type CopilotPage,
  type KeysetCursor,
} from './cursor';
