/**
 * Gerador de sugestões do piloto automático (F73-S13). Reexportado por `src/copilot` →
 * `src/index.ts`: o worker de hora em hora chama `generateSuggestions(tx, workspaceId, now)`.
 */
export {
  CREATE_PER_RULE_PER_TICK,
  DECIDED_COOLDOWN_DAYS,
  PENDING_CAP_PER_RULE,
  generateSuggestions,
  type GenerateSuggestionsResult,
} from './generate';
export {
  CONFIDENCE_MIN_WINS,
  CONFIDENCE_WINDOW_DAYS,
  computeConfidence,
  loadStageDwell,
  type Confidence,
  type ConfidenceBasis,
  type ConfidenceLevel,
  type StageDwell,
} from './confidence';
export {
  REASON_TEXT_MAX,
  buildReason,
  composeReasonText,
  confidenceSentence,
  formatShortDate,
  type Reason,
  type ReasonInput,
  type SuggestionReasonCode,
} from './reason';
