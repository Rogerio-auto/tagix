/**
 * Piloto automático do pipeline, lado API (F73-S13): regras por estágio, lista de sugestões e
 * decisão em lote pelo motor de propostas. O gerador das sugestões vive em `@hm/db`
 * (`generateSuggestions`) e roda no worker de hora em hora.
 */
export {
  AUTOPILOT_AUDIT_RESOURCE,
  RULES_FAILURE_MESSAGES,
  listAutopilotRules,
  updateAutopilotRules,
  type RulesFailure,
  type RulesUpdated,
} from './rules';
export {
  SUGGESTIONS_PAGE_DEFAULT,
  SUGGESTIONS_PAGE_MAX,
  countPendingSuggestions,
  listSuggestions,
  type ListSuggestionsInput,
  type SuggestionPage,
} from './suggestions';
export {
  DECIDE_EXECUTION_WAIT_MS,
  decideSuggestions,
  type DecideDeps,
  type DecideProposalRef,
  type DecideResult,
} from './decide';
export {
  summarizeDecision,
  summaryFamily,
  type DecideItem,
  type DecideItemStatus,
  type DecideSkipReason,
} from './summary';
export {
  emitSuggestionsChangedSafely,
  relaySuggestionsChanged,
  type SuggestionsChangedEmitter,
} from './emit';
