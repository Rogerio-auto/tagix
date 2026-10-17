/**
 * Enums de status do Copiloto (COPILOTO.md §4 e §6.3).
 *
 * São os MESMOS valores dos `check` do banco (F73-S01, `packages/db/src/schema/copilot.ts`).
 * Ficam duplicados aqui de propósito: `@hm/shared` é importado pelo navegador e não pode
 * depender de `@hm/db`. A igualdade é garantida por teste (`statuses.test.ts`), que o
 * F73-S03 liga quando o `@hm/db` exportar os enums.
 *
 * Regra: valor novo entra primeiro na migração (S01), depois aqui, no mesmo PR.
 */

/**
 * Ciclo de vida da proposta (§6.3).
 *
 * `confirmed` segue o diagrama: é o estado em que a proposta aprovada (por quem pediu ou
 * pelo aprovador) espera o executor pegar o lease. O CAS do ADR-004 §2 pode saltar direto
 * para `executing`; o valor existe para o caminho do aprovador e para o banco aceitar.
 */
export const COPILOT_PROPOSAL_STATUSES = [
  'proposed',
  'awaiting_approval',
  'blocked',
  'confirmed',
  'executing',
  'completed',
  'partially_completed',
  'failed',
  'cancelled',
  'expired',
  'undone',
  'partially_undone',
] as const;
export type CopilotProposalStatus = (typeof COPILOT_PROPOSAL_STATUSES)[number];

/** Status que ainda aceitam confirmar (ADR-004 §2). */
export const COPILOT_PROPOSAL_OPEN_STATUSES = [
  'proposed',
  'awaiting_approval',
] as const satisfies readonly CopilotProposalStatus[];

/** Status terminais: nada mais muda, salvo desfazer em `completed`/`partially_completed`. */
export const COPILOT_PROPOSAL_TERMINAL_STATUSES = [
  'completed',
  'partially_completed',
  'failed',
  'cancelled',
  'expired',
  'undone',
  'partially_undone',
] as const satisfies readonly CopilotProposalStatus[];

/** Status de cada alvo da proposta (`copilot_action_items.status`). */
export const COPILOT_ITEM_STATUSES = [
  'pending',
  'done',
  'skipped_conflict',
  'skipped_policy',
  'failed',
  'undone',
  'undo_conflict',
  'excluded',
] as const;
export type CopilotItemStatus = (typeof COPILOT_ITEM_STATUSES)[number];

/** Tipo de alvo (`copilot_action_items.target_type`). */
export const COPILOT_ITEM_TARGET_TYPES = [
  'deal',
  'contact',
  'conversation',
  'event',
  'campaign',
  'message',
] as const;
export type CopilotItemTargetType = (typeof COPILOT_ITEM_TARGET_TYPES)[number];

/** Origem da proposta (`copilot_action_proposals.source`). */
export const COPILOT_PROPOSAL_SOURCES = ['copilot', 'autopilot'] as const;
export type CopilotProposalSource = (typeof COPILOT_PROPOSAL_SOURCES)[number];

/** Status do turno (`copilot_turns.status`). */
export const COPILOT_TURN_STATUSES = [
  'running',
  'completed',
  'failed',
  'cancelled',
  'budget_blocked',
  'rate_limited',
] as const;
export type CopilotTurnStatus = (typeof COPILOT_TURN_STATUSES)[number];

/** Decisão registrada para cada chamada de ferramenta (`copilot_tool_calls.decision`). */
export const COPILOT_TOOL_DECISIONS = [
  'executed',
  'proposed',
  'blocked',
  'denied',
  'invalid_args',
  'error',
] as const;
export type CopilotToolDecision = (typeof COPILOT_TOOL_DECISIONS)[number];

/** Papel da mensagem na sessão (`copilot_messages.role`). */
export const COPILOT_MESSAGE_ROLES = ['user', 'assistant', 'event'] as const;
export type CopilotMessageRole = (typeof COPILOT_MESSAGE_ROLES)[number];

/** De onde a sessão foi aberta (`copilot_sessions.origin`). */
export const COPILOT_SESSION_ORIGINS = [
  'bubble',
  'docked',
  'fullscreen',
  'palette',
  'briefing',
  'mobile',
] as const;
export type CopilotSessionOrigin = (typeof COPILOT_SESSION_ORIGINS)[number];

/** Superfície preferida (`copilot_member_prefs.surface`). */
export const COPILOT_SURFACES = ['bubble', 'docked'] as const;
export type CopilotSurface = (typeof COPILOT_SURFACES)[number];

/** Abertura automática (`copilot_settings.default_auto_open` e `copilot_member_prefs.auto_open`). */
export const COPILOT_AUTO_OPEN = ['always', 'daily', 'never'] as const;
export type CopilotAutoOpen = (typeof COPILOT_AUTO_OPEN)[number];

/** O que acontece no teto do orçamento (`copilot_settings.budget_mode`). */
export const COPILOT_BUDGET_MODES = ['queries_only', 'pause'] as const;
export type CopilotBudgetMode = (typeof COPILOT_BUDGET_MODES)[number];

/** Retenção do histórico em meses (`copilot_settings.history_retention_months`). */
export const COPILOT_HISTORY_RETENTION_MONTHS = [6, 12, 24] as const;
export type CopilotHistoryRetentionMonths = (typeof COPILOT_HISTORY_RETENTION_MONTHS)[number];

/** Memória: tipo da entrada (`copilot_memory_entries.kind`). */
export const COPILOT_MEMORY_KINDS = ['profile', 'fact'] as const;
export type CopilotMemoryKind = (typeof COPILOT_MEMORY_KINDS)[number];

/** Memória: chaves fixas do perfil (`copilot_memory_entries.profile_key`). */
export const COPILOT_MEMORY_PROFILE_KEYS = [
  'what_we_sell',
  'avg_ticket',
  'tone',
  'hours',
  'commercial_rules',
] as const;
export type CopilotMemoryProfileKey = (typeof COPILOT_MEMORY_PROFILE_KEYS)[number];

/** Memória: quem escreveu (`copilot_memory_entries.source_type`). */
export const COPILOT_MEMORY_SOURCE_TYPES = ['member', 'copilot', 'integration'] as const;
export type CopilotMemorySourceType = (typeof COPILOT_MEMORY_SOURCE_TYPES)[number];

/** Memória: estado (`copilot_memory_entries.status`). */
export const COPILOT_MEMORY_STATUSES = ['active', 'forgotten', 'superseded'] as const;
export type CopilotMemoryStatus = (typeof COPILOT_MEMORY_STATUSES)[number];

/** Briefing do dia (`copilot_briefings.status`). */
export const COPILOT_BRIEFING_STATUSES = ['ready', 'empty', 'stale', 'failed'] as const;
export type CopilotBriefingStatus = (typeof COPILOT_BRIEFING_STATUSES)[number];

/** Piloto automático por estágio (`copilot_autopilot_rules.mode`). `auto` é v1.1: a API recusa. */
export const COPILOT_AUTOPILOT_MODES = ['off', 'suggest', 'daily_approval', 'auto'] as const;
export type CopilotAutopilotMode = (typeof COPILOT_AUTOPILOT_MODES)[number];

/** Confiança da sugestão (`copilot_suggestions.confidence`). Nunca número cru na tela. */
export const COPILOT_SUGGESTION_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type CopilotSuggestionConfidence = (typeof COPILOT_SUGGESTION_CONFIDENCES)[number];

/** Status da sugestão (`copilot_suggestions.status`). */
export const COPILOT_SUGGESTION_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'superseded',
  'auto_applied',
] as const;
export type CopilotSuggestionStatus = (typeof COPILOT_SUGGESTION_STATUSES)[number];

/**
 * Todos os enums que têm `check` no banco, por nome. É o que o teste de igualdade com o
 * `@hm/db` percorre: um enum novo aqui sem par no banco (ou o contrário) quebra o teste.
 */
export const COPILOT_DB_ENUMS = {
  proposalStatus: COPILOT_PROPOSAL_STATUSES,
  itemStatus: COPILOT_ITEM_STATUSES,
  itemTargetType: COPILOT_ITEM_TARGET_TYPES,
  proposalSource: COPILOT_PROPOSAL_SOURCES,
  turnStatus: COPILOT_TURN_STATUSES,
  toolDecision: COPILOT_TOOL_DECISIONS,
  messageRole: COPILOT_MESSAGE_ROLES,
  sessionOrigin: COPILOT_SESSION_ORIGINS,
  surface: COPILOT_SURFACES,
  autoOpen: COPILOT_AUTO_OPEN,
  budgetMode: COPILOT_BUDGET_MODES,
  historyRetentionMonths: COPILOT_HISTORY_RETENTION_MONTHS,
  memoryKind: COPILOT_MEMORY_KINDS,
  memoryProfileKey: COPILOT_MEMORY_PROFILE_KEYS,
  memorySourceType: COPILOT_MEMORY_SOURCE_TYPES,
  memoryStatus: COPILOT_MEMORY_STATUSES,
  briefingStatus: COPILOT_BRIEFING_STATUSES,
  autopilotMode: COPILOT_AUTOPILOT_MODES,
  suggestionConfidence: COPILOT_SUGGESTION_CONFIDENCES,
  suggestionStatus: COPILOT_SUGGESTION_STATUSES,
} as const;
export type CopilotDbEnumName = keyof typeof COPILOT_DB_ENUMS;
