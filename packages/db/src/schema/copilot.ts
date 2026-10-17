/**
 * Copiloto (F73-S01 — docs/features/COPILOTO.md §4, ADR-003, ADR-004). Migração 0097.
 *
 * 12 tabelas, todas com `workspace_id` → RLS por workspace (FORCE) na migração:
 *
 *   copilot_settings          1:1 workspace — liga/desliga, matriz capacidade × papel, orçamento
 *   copilot_member_prefs      1:1 membro — abertura automática, superfície, dica de primeiro uso
 *   copilot_sessions          conversas (privadas do membro: quem filtra por membro é o service)
 *   copilot_messages          mensagens da sessão (pergunta, veredito, cartões persistidos)
 *   copilot_turns             turno = credencial das chamadas de ferramenta (ADR-003 §2)
 *   copilot_tool_calls        log de cada chamada de ferramenta (sem PII)
 *   copilot_action_proposals  proposta de ação (ADR-004) — CAS por `version`, lease de execução
 *   copilot_action_items      um alvo da proposta (before/after/undo_payload)
 *   copilot_memory_entries    perfil do negócio e fatos, com fonte; nunca apaga (supersede)
 *   copilot_briefings         briefing do dia por membro
 *   copilot_autopilot_rules   autonomia por estágio
 *   copilot_suggestions       fila de sugestões do piloto automático
 *
 * ## Referências por workspace
 *
 * Toda referência a entidade tenant é FK COMPOSTA `(workspace_id, x_id) → alvo (workspace_id, id)`
 * (padrão F70-S12): a checagem de FK roda fora da RLS, e a composta obriga o alvo a ser do mesmo
 * workspace. Nas anuláveis a migração usa `ON DELETE SET NULL (coluna)` (PG ≥ 15), que o Drizzle
 * não expressa — o SQL da 0097 é a fonte de verdade. As tabelas do Copiloto referenciadas por
 * outras ganham `uq_<tabela>_workspace_id (workspace_id, id)`; `deals` ganha o seu na migração
 * (`uq_deals_workspace_id`, declarado só no SQL porque `schema/pipeline.ts` é de outro domínio).
 *
 * ## Enums
 *
 * Todo enum de texto tem CHECK no banco, gerado da MESMA constante `as const` exportada aqui. O
 * `@hm/shared` (F73-S02) espelha estas constantes em Zod e um teste lá confere a igualdade; um
 * teste aqui (`copilot.test.ts`) confere constante × CHECK do Postgres.
 *
 * ## Colunas sem FK de propósito
 *
 * `audit_logs.copilot_proposal_id/copilot_turn_id` e `llm_usage_logs.copilot_turn_id` são só
 * correlação: a trilha e o custo sobrevivem à retenção do histórico do Copiloto (F73-S15).
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { members, workspaces } from './index';
import { deals, stages } from './pipeline';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * pgvector `vector(N)` — mesma definição de `schema/knowledge.ts` (lá não é exportada e o
 * arquivo é de outro domínio). No TS o vetor trafega como `number[]`.
 */
const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(',')}]`;
    },
    fromDriver(value: string): number[] {
      return value
        .slice(1, -1)
        .split(',')
        .filter((v) => v.length > 0)
        .map(Number);
    },
  })(name);

// ─── Enums (fonte única: CHECK do banco + Zod do @hm/shared) ─────────────────────

export const COPILOT_BUDGET_MODES = ['queries_only', 'pause'] as const;
export type CopilotBudgetMode = (typeof COPILOT_BUDGET_MODES)[number];

/** Abertura automática do Copiloto (padrão do workspace e preferência do membro). */
export const COPILOT_AUTO_OPEN_MODES = ['always', 'daily', 'never'] as const;
export type CopilotAutoOpenMode = (typeof COPILOT_AUTO_OPEN_MODES)[number];

export const COPILOT_HISTORY_RETENTION_MONTHS = [6, 12, 24] as const;
export type CopilotHistoryRetentionMonths = (typeof COPILOT_HISTORY_RETENTION_MONTHS)[number];

/** Superfície preferida do membro. */
export const COPILOT_SURFACES = ['bubble', 'docked'] as const;
export type CopilotSurface = (typeof COPILOT_SURFACES)[number];

export const COPILOT_SESSION_ORIGINS = [
  'bubble',
  'docked',
  'fullscreen',
  'palette',
  'briefing',
  'mobile',
] as const;
export type CopilotSessionOrigin = (typeof COPILOT_SESSION_ORIGINS)[number];

export const COPILOT_MESSAGE_ROLES = ['user', 'assistant', 'event'] as const;
export type CopilotMessageRole = (typeof COPILOT_MESSAGE_ROLES)[number];

export const COPILOT_TURN_STATUSES = [
  'running',
  'completed',
  'failed',
  'cancelled',
  'budget_blocked',
  'rate_limited',
] as const;
export type CopilotTurnStatus = (typeof COPILOT_TURN_STATUSES)[number];
/** Estados finais de turno aceitos por `copilotTurnsRepo.fail`. */
export type CopilotTurnFailureStatus = Exclude<CopilotTurnStatus, 'running' | 'completed'>;

export const COPILOT_TOOL_CALL_DECISIONS = [
  'executed',
  'proposed',
  'blocked',
  'denied',
  'invalid_args',
  'error',
] as const;
export type CopilotToolCallDecision = (typeof COPILOT_TOOL_CALL_DECISIONS)[number];

export const COPILOT_RISK_LEVELS = [1, 2, 3, 4] as const;
export type CopilotRiskLevel = (typeof COPILOT_RISK_LEVELS)[number];

export const COPILOT_PROPOSAL_SOURCES = ['copilot', 'autopilot'] as const;
export type CopilotProposalSource = (typeof COPILOT_PROPOSAL_SOURCES)[number];

/** Ciclo de vida da proposta (spec §6.3). */
export const COPILOT_PROPOSAL_STATUSES = [
  'proposed',
  'blocked',
  'awaiting_approval',
  'expired',
  'cancelled',
  'confirmed',
  'executing',
  'completed',
  'partially_completed',
  'failed',
  'undone',
  'partially_undone',
] as const;
export type CopilotProposalStatus = (typeof COPILOT_PROPOSAL_STATUSES)[number];

/** Motivo de bloqueio (mesmos valores de `action_blocked.reason`, spec §5.3). */
export const COPILOT_BLOCKED_REASONS = [
  'role',
  'capability_disabled',
  'subscription_inactive',
  'budget',
  'scope',
] as const;
export type CopilotBlockedReason = (typeof COPILOT_BLOCKED_REASONS)[number];

export const COPILOT_ACTION_TARGET_TYPES = [
  'deal',
  'contact',
  'conversation',
  'event',
  'campaign',
  'message',
] as const;
export type CopilotActionTargetType = (typeof COPILOT_ACTION_TARGET_TYPES)[number];

export const COPILOT_ACTION_ITEM_STATUSES = [
  'pending',
  'done',
  'skipped_conflict',
  'skipped_policy',
  'failed',
  'undone',
  'undo_conflict',
  'excluded',
] as const;
export type CopilotActionItemStatus = (typeof COPILOT_ACTION_ITEM_STATUSES)[number];

export const COPILOT_MEMORY_KINDS = ['profile', 'fact'] as const;
export type CopilotMemoryKind = (typeof COPILOT_MEMORY_KINDS)[number];

export const COPILOT_MEMORY_PROFILE_KEYS = [
  'what_we_sell',
  'avg_ticket',
  'tone',
  'hours',
  'commercial_rules',
] as const;
export type CopilotMemoryProfileKey = (typeof COPILOT_MEMORY_PROFILE_KEYS)[number];

/** Fonte do fato. A ordem é a prioridade no prompt: pessoa → Copiloto → integração. */
export const COPILOT_MEMORY_SOURCE_TYPES = ['member', 'copilot', 'integration'] as const;
export type CopilotMemorySourceType = (typeof COPILOT_MEMORY_SOURCE_TYPES)[number];

export const COPILOT_MEMORY_STATUSES = ['active', 'forgotten', 'superseded'] as const;
export type CopilotMemoryStatus = (typeof COPILOT_MEMORY_STATUSES)[number];

export const COPILOT_BRIEFING_STATUSES = ['ready', 'empty', 'stale', 'failed'] as const;
export type CopilotBriefingStatus = (typeof COPILOT_BRIEFING_STATUSES)[number];

/** `auto` é aceito no banco e recusado pela API até a v1.1 (F73-S16). */
export const COPILOT_AUTOPILOT_MODES = ['off', 'suggest', 'daily_approval', 'auto'] as const;
export type CopilotAutopilotMode = (typeof COPILOT_AUTOPILOT_MODES)[number];

export const COPILOT_SUGGESTION_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type CopilotSuggestionConfidence = (typeof COPILOT_SUGGESTION_CONFIDENCES)[number];

export const COPILOT_SUGGESTION_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'superseded',
  'auto_applied',
] as const;
export type CopilotSuggestionStatus = (typeof COPILOT_SUGGESTION_STATUSES)[number];

// ─── Tipos dos jsonb (o shape fino é validado em Zod no @hm/shared) ──────────────

/** `{ [role]: { [capability]: boolean } }`. Ausente = herda a permissão do papel. */
export type CopilotCapabilityMatrix = Record<string, Record<string, boolean>>;
export type CopilotJsonObject = Record<string, unknown>;
export interface CopilotAutopilotCriteria {
  idle_days?: number;
  target_stage_id?: string;
  require_last_outbound?: boolean;
}

// ─── Helpers de CHECK ────────────────────────────────────────────────────────────

const ENUM_TOKEN = /^[a-z0-9_]+$/;

/** `col in ('a','b')` a partir da constante — o CHECK nunca diverge do enum exportado. */
function inList(col: AnyPgColumn, values: readonly string[]): SQL {
  for (const v of values) {
    if (!ENUM_TOKEN.test(v)) throw new Error(`copilot: valor de enum inválido: ${v}`);
  }
  return sql`${col} in (${sql.raw(values.map((v) => `'${v}'`).join(','))})`;
}

function inNumbers(col: AnyPgColumn, values: readonly number[]): SQL {
  return sql`${col} in (${sql.raw(values.map((v) => String(Math.trunc(v))).join(','))})`;
}

// ─── copilot_settings ────────────────────────────────────────────────────────────

export const copilotSettings = pgTable(
  'copilot_settings',
  {
    workspaceId: uuid('workspace_id')
      .primaryKey()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    capabilityMatrix: jsonb('capability_matrix')
      .$type<CopilotCapabilityMatrix>()
      .notNull()
      .default({}),
    /** Dinheiro: numeric como string (nunca `real`). */
    monthlyBudgetUsd: numeric('monthly_budget_usd', { precision: 10, scale: 2 })
      .notNull()
      .default('30.00'),
    budgetMode: text('budget_mode').$type<CopilotBudgetMode>().notNull().default('queries_only'),
    budgetAlertPct: integer('budget_alert_pct').notNull().default(80),
    historyRetentionMonths: integer('history_retention_months')
      .$type<CopilotHistoryRetentionMonths>()
      .notNull()
      .default(12),
    defaultAutoOpen: text('default_auto_open')
      .$type<CopilotAutoOpenMode>()
      .notNull()
      .default('daily'),
    partnerAccess: boolean('partner_access').notNull().default(false),
    /** null = modelo padrão da plataforma. */
    model: text('model'),
    updatedBy: uuid('updated_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_copilot_settings_updated_by')
      .on(t.workspaceId, t.updatedBy)
      .where(sql`${t.updatedBy} is not null`),
    foreignKey({
      name: 'copilot_settings_workspace_updated_by_fk',
      columns: [t.workspaceId, t.updatedBy],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('set null'),
    check('copilot_settings_budget_mode_chk', inList(t.budgetMode, COPILOT_BUDGET_MODES)),
    check(
      'copilot_settings_default_auto_open_chk',
      inList(t.defaultAutoOpen, COPILOT_AUTO_OPEN_MODES),
    ),
    check(
      'copilot_settings_history_retention_chk',
      inNumbers(t.historyRetentionMonths, COPILOT_HISTORY_RETENTION_MONTHS),
    ),
    check('copilot_settings_budget_chk', sql`${t.monthlyBudgetUsd} >= 0`),
    check('copilot_settings_alert_pct_chk', sql`${t.budgetAlertPct} between 1 and 100`),
    check('copilot_settings_matrix_chk', sql`jsonb_typeof(${t.capabilityMatrix}) = 'object'`),
    check(
      'copilot_settings_model_chk',
      sql`${t.model} is null or char_length(${t.model}) between 1 and 200`,
    ),
  ],
);

// ─── copilot_member_prefs ────────────────────────────────────────────────────────

export const copilotMemberPrefs = pgTable(
  'copilot_member_prefs',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    /** null = herda `copilot_settings.default_auto_open`. */
    autoOpen: text('auto_open').$type<CopilotAutoOpenMode>(),
    /** Data local (fuso do membro) do último briefing visto. */
    briefingLastSeenOn: date('briefing_last_seen_on', { mode: 'string' }),
    surface: text('surface').$type<CopilotSurface>().notNull().default('bubble'),
    firstUseHintSeenAt: ts('first_use_hint_seen_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'copilot_member_prefs_pkey', columns: [t.workspaceId, t.memberId] }),
    foreignKey({
      name: 'copilot_member_prefs_workspace_member_fk',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('cascade'),
    check(
      'copilot_member_prefs_auto_open_chk',
      sql`${t.autoOpen} is null or ${inList(t.autoOpen, COPILOT_AUTO_OPEN_MODES)}`,
    ),
    check('copilot_member_prefs_surface_chk', inList(t.surface, COPILOT_SURFACES)),
  ],
);

// ─── copilot_sessions ────────────────────────────────────────────────────────────

export const copilotSessions = pgTable(
  'copilot_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    /** null até o primeiro título (gerado ou renomeado). */
    title: text('title'),
    origin: text('origin').$type<CopilotSessionOrigin>().notNull(),
    lastPageContext: jsonb('last_page_context').$type<CopilotJsonObject>(),
    archivedAt: ts('archived_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_copilot_sessions_workspace_id').on(t.workspaceId, t.id),
    // Lista do membro (keyset por updated_at, id).
    index('idx_copilot_sessions_member_updated').on(
      t.workspaceId,
      t.memberId,
      t.updatedAt.desc(),
      t.id.desc(),
    ),
    foreignKey({
      name: 'copilot_sessions_workspace_member_fk',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('cascade'),
    check('copilot_sessions_origin_chk', inList(t.origin, COPILOT_SESSION_ORIGINS)),
    check(
      'copilot_sessions_title_chk',
      sql`${t.title} is null or char_length(btrim(${t.title})) between 1 and 80`,
    ),
  ],
);

// ─── copilot_turns ───────────────────────────────────────────────────────────────

export const copilotTurns = pgTable(
  'copilot_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    status: text('status').$type<CopilotTurnStatus>().notNull().default('running'),
    /** Nonce do grant HMAC (ADR-003 §2). Conferido a cada chamada de ferramenta. */
    grantNonce: text('grant_nonce').notNull(),
    expiresAt: ts('expires_at').notNull(),
    toolCalls: integer('tool_calls').notNull().default(0),
    maxToolCalls: integer('max_tool_calls').notNull(),
    /** Leu conteúdo de contato → toda escrita sobe para nível ≥ 3 (ADR-004 §6). */
    tainted: boolean('tainted').notNull().default(false),
    model: text('model'),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 8 }).notNull().default('0'),
    iterations: integer('iterations').notNull().default(0),
    errorCode: text('error_code'),
    /** Idempotência do POST de mensagem (o cliente reenvia o mesmo id). */
    clientRequestId: text('client_request_id'),
    startedAt: ts('started_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
  },
  (t) => [
    uniqueIndex('uq_copilot_turns_workspace_id').on(t.workspaceId, t.id),
    uniqueIndex('uq_copilot_turns_client_request')
      .on(t.workspaceId, t.memberId, t.clientRequestId)
      .where(sql`${t.clientRequestId} is not null`),
    index('idx_copilot_turns_member_started').on(t.memberId, t.startedAt.desc()),
    index('idx_copilot_turns_running')
      .on(t.workspaceId, t.memberId)
      .where(sql`${t.status} = 'running'`),
    index('idx_copilot_turns_session').on(t.sessionId),
    foreignKey({
      name: 'copilot_turns_workspace_member_fk',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'copilot_turns_workspace_session_fk',
      columns: [t.workspaceId, t.sessionId],
      foreignColumns: [copilotSessions.workspaceId, copilotSessions.id],
    }).onDelete('cascade'),
    check('copilot_turns_status_chk', inList(t.status, COPILOT_TURN_STATUSES)),
    check('copilot_turns_nonce_chk', sql`char_length(${t.grantNonce}) between 16 and 128`),
    check('copilot_turns_max_tool_calls_chk', sql`${t.maxToolCalls} between 1 and 64`),
    check(
      'copilot_turns_tool_calls_chk',
      sql`${t.toolCalls} >= 0 and ${t.toolCalls} <= ${t.maxToolCalls}`,
    ),
    check(
      'copilot_turns_usage_chk',
      sql`${t.promptTokens} >= 0 and ${t.completionTokens} >= 0 and ${t.iterations} >= 0 and ${t.costUsd} >= 0`,
    ),
    check(
      'copilot_turns_client_request_chk',
      sql`${t.clientRequestId} is null or char_length(${t.clientRequestId}) between 1 and 128`,
    ),
    // Turno vivo não tem fim; turno encerrado tem.
    check(
      'copilot_turns_completed_chk',
      sql`(${t.status} = 'running') = (${t.completedAt} is null)`,
    ),
  ],
);

// ─── copilot_action_proposals ────────────────────────────────────────────────────

export const copilotActionProposals = pgTable(
  'copilot_action_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id'),
    turnId: uuid('turn_id'),
    source: text('source').$type<CopilotProposalSource>().notNull().default('copilot'),
    capability: text('capability').notNull(),
    riskLevel: smallint('risk_level').$type<CopilotRiskLevel>().notNull(),
    status: text('status').$type<CopilotProposalStatus>().notNull(),
    /** Quem pediu. Anulável só para a exclusão do membro não apagar a trilha. */
    requestedByMemberId: uuid('requested_by_member_id'),
    /** Membro cujas permissões foram usadas na execução (o aprovador, no fluxo de aprovação). */
    executedAsMemberId: uuid('executed_as_member_id'),
    approverMemberId: uuid('approver_member_id'),
    args: jsonb('args').$type<CopilotJsonObject>().notNull().default({}),
    preview: jsonb('preview').$type<CopilotJsonObject>().notNull().default({}),
    policyChecks: jsonb('policy_checks').$type<CopilotJsonObject[]>(),
    blockedReason: text('blocked_reason').$type<CopilotBlockedReason>(),
    summary: text('summary').notNull(),
    confirmIdempotencyKey: text('confirm_idempotency_key'),
    expiresAt: ts('expires_at'),
    confirmedAt: ts('confirmed_at'),
    executedAt: ts('executed_at'),
    completedAt: ts('completed_at'),
    leaseExpiresAt: ts('lease_expires_at'),
    stopRequested: boolean('stop_requested').notNull().default(false),
    undoDeadline: ts('undo_deadline'),
    undoneAt: ts('undone_at'),
    undoneBy: uuid('undone_by'),
    /** Versão otimista: toda transição e todo ajuste incrementam (CAS do confirmar). */
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_copilot_action_proposals_workspace_id').on(t.workspaceId, t.id),
    // Atividade "todas" e "minhas" (keyset por created_at, id).
    index('idx_copilot_proposals_workspace_created').on(
      t.workspaceId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('idx_copilot_proposals_requester_created').on(
      t.workspaceId,
      t.requestedByMemberId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    // Varredura: expirar propostas abertas.
    index('idx_copilot_proposals_open_expires')
      .on(t.status, t.expiresAt)
      .where(sql`${t.status} in ('proposed','awaiting_approval')`),
    // Varredura: retomar lote com lease vencido.
    index('idx_copilot_proposals_executing_lease')
      .on(t.status, t.leaseExpiresAt)
      .where(sql`${t.status} = 'executing'`),
    // "Aguardando a minha aprovação" + alvo do SET NULL ao apagar membro.
    index('idx_copilot_proposals_approver')
      .on(t.workspaceId, t.approverMemberId)
      .where(sql`${t.approverMemberId} is not null`),
    index('idx_copilot_proposals_executed_as')
      .on(t.workspaceId, t.executedAsMemberId)
      .where(sql`${t.executedAsMemberId} is not null`),
    index('idx_copilot_proposals_undone_by')
      .on(t.workspaceId, t.undoneBy)
      .where(sql`${t.undoneBy} is not null`),
    index('idx_copilot_proposals_session')
      .on(t.sessionId)
      .where(sql`${t.sessionId} is not null`),
    index('idx_copilot_proposals_turn')
      .on(t.turnId)
      .where(sql`${t.turnId} is not null`),
    foreignKey({
      name: 'copilot_proposals_workspace_session_fk',
      columns: [t.workspaceId, t.sessionId],
      foreignColumns: [copilotSessions.workspaceId, copilotSessions.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'copilot_proposals_workspace_turn_fk',
      columns: [t.workspaceId, t.turnId],
      foreignColumns: [copilotTurns.workspaceId, copilotTurns.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'copilot_proposals_workspace_requested_by_fk',
      columns: [t.workspaceId, t.requestedByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'copilot_proposals_workspace_executed_as_fk',
      columns: [t.workspaceId, t.executedAsMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'copilot_proposals_workspace_approver_fk',
      columns: [t.workspaceId, t.approverMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'copilot_proposals_workspace_undone_by_fk',
      columns: [t.workspaceId, t.undoneBy],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('set null'),
    check('copilot_proposals_source_chk', inList(t.source, COPILOT_PROPOSAL_SOURCES)),
    check('copilot_proposals_status_chk', inList(t.status, COPILOT_PROPOSAL_STATUSES)),
    check('copilot_proposals_risk_level_chk', sql`${t.riskLevel} between 1 and 4`),
    check(
      'copilot_proposals_blocked_reason_chk',
      sql`${t.blockedReason} is null or ${inList(t.blockedReason, COPILOT_BLOCKED_REASONS)}`,
    ),
    check(
      'copilot_proposals_blocked_has_reason_chk',
      sql`${t.status} <> 'blocked' or ${t.blockedReason} is not null`,
    ),
    check(
      'copilot_proposals_open_expires_chk',
      sql`${t.status} not in ('proposed','awaiting_approval') or ${t.expiresAt} is not null`,
    ),
    check(
      'copilot_proposals_executing_lease_chk',
      sql`${t.status} <> 'executing' or ${t.leaseExpiresAt} is not null`,
    ),
    check('copilot_proposals_capability_chk', sql`char_length(${t.capability}) between 1 and 80`),
    check('copilot_proposals_summary_chk', sql`char_length(btrim(${t.summary})) between 1 and 500`),
    check(
      'copilot_proposals_idempotency_key_chk',
      sql`${t.confirmIdempotencyKey} is null or char_length(${t.confirmIdempotencyKey}) between 1 and 128`,
    ),
    check('copilot_proposals_version_chk', sql`${t.version} >= 1`),
  ],
);

// ─── copilot_messages ────────────────────────────────────────────────────────────

export const copilotMessages = pgTable(
  'copilot_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').notNull(),
    turnId: uuid('turn_id'),
    role: text('role').$type<CopilotMessageRole>().notNull(),
    /** Pergunta do membro ou veredito. */
    content: text('content').notNull(),
    /** `CopilotAnswerBlocks` (validado no @hm/shared). */
    blocks: jsonb('blocks').$type<CopilotJsonObject>(),
    /** Cartões persistidos para reabrir o histórico. */
    toolResults: jsonb('tool_results').$type<CopilotJsonObject[]>(),
    pageContext: jsonb('page_context').$type<CopilotJsonObject>(),
    proposalId: uuid('proposal_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_copilot_messages_session_created').on(t.sessionId, t.createdAt, t.id),
    index('idx_copilot_messages_turn')
      .on(t.turnId)
      .where(sql`${t.turnId} is not null`),
    index('idx_copilot_messages_proposal')
      .on(t.proposalId)
      .where(sql`${t.proposalId} is not null`),
    foreignKey({
      name: 'copilot_messages_workspace_session_fk',
      columns: [t.workspaceId, t.sessionId],
      foreignColumns: [copilotSessions.workspaceId, copilotSessions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'copilot_messages_workspace_turn_fk',
      columns: [t.workspaceId, t.turnId],
      foreignColumns: [copilotTurns.workspaceId, copilotTurns.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'copilot_messages_workspace_proposal_fk',
      columns: [t.workspaceId, t.proposalId],
      foreignColumns: [copilotActionProposals.workspaceId, copilotActionProposals.id],
    }).onDelete('set null'),
    check('copilot_messages_role_chk', inList(t.role, COPILOT_MESSAGE_ROLES)),
    check('copilot_messages_content_chk', sql`char_length(${t.content}) <= 32000`),
  ],
);

// ─── copilot_tool_calls ──────────────────────────────────────────────────────────

export const copilotToolCalls = pgTable(
  'copilot_tool_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id').notNull(),
    memberId: uuid('member_id').notNull(),
    toolKey: text('tool_key').notNull(),
    /** Argumentos já redigidos (sem PII). */
    argsRedacted: jsonb('args_redacted').$type<CopilotJsonObject>().notNull().default({}),
    /** Contagens, `result_id`; sem PII. */
    resultMeta: jsonb('result_meta').$type<CopilotJsonObject>().notNull().default({}),
    decision: text('decision').$type<CopilotToolCallDecision>().notNull(),
    riskLevel: smallint('risk_level').$type<CopilotRiskLevel>(),
    errorCode: text('error_code'),
    durationMs: integer('duration_ms'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_copilot_tool_calls_turn').on(t.turnId),
    index('idx_copilot_tool_calls_workspace_created').on(t.workspaceId, t.createdAt.desc()),
    index('idx_copilot_tool_calls_member').on(t.workspaceId, t.memberId),
    foreignKey({
      name: 'copilot_tool_calls_workspace_turn_fk',
      columns: [t.workspaceId, t.turnId],
      foreignColumns: [copilotTurns.workspaceId, copilotTurns.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'copilot_tool_calls_workspace_member_fk',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('cascade'),
    check('copilot_tool_calls_decision_chk', inList(t.decision, COPILOT_TOOL_CALL_DECISIONS)),
    check(
      'copilot_tool_calls_risk_level_chk',
      sql`${t.riskLevel} is null or ${t.riskLevel} between 1 and 4`,
    ),
    check('copilot_tool_calls_tool_key_chk', sql`char_length(${t.toolKey}) between 1 and 80`),
    check('copilot_tool_calls_duration_chk', sql`${t.durationMs} is null or ${t.durationMs} >= 0`),
  ],
);

// ─── copilot_action_items ────────────────────────────────────────────────────────

export const copilotActionItems = pgTable(
  'copilot_action_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id').notNull(),
    /** Ordem de execução dentro da proposta (o desfazer percorre ao contrário). */
    position: integer('position').notNull(),
    targetType: text('target_type').$type<CopilotActionTargetType>().notNull(),
    targetId: uuid('target_id').notNull(),
    status: text('status').$type<CopilotActionItemStatus>().notNull().default('pending'),
    /** Versão do alvo na prévia (ex.: `updated_at` + `stage_id`); conferida antes de escrever. */
    expectedVersion: text('expected_version'),
    before: jsonb('before').$type<CopilotJsonObject>(),
    after: jsonb('after').$type<CopilotJsonObject>(),
    undoPayload: jsonb('undo_payload').$type<CopilotJsonObject>(),
    errorCode: text('error_code'),
    executedAt: ts('executed_at'),
    undoneAt: ts('undone_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_copilot_action_items_proposal_position').on(t.proposalId, t.position),
    // Um alvo aparece uma vez por proposta (sem execução dupla do mesmo registro).
    uniqueIndex('uq_copilot_action_items_proposal_target').on(
      t.proposalId,
      t.targetType,
      t.targetId,
    ),
    index('idx_copilot_action_items_target').on(t.workspaceId, t.targetType, t.targetId),
    foreignKey({
      name: 'copilot_action_items_workspace_proposal_fk',
      columns: [t.workspaceId, t.proposalId],
      foreignColumns: [copilotActionProposals.workspaceId, copilotActionProposals.id],
    }).onDelete('cascade'),
    check(
      'copilot_action_items_target_type_chk',
      inList(t.targetType, COPILOT_ACTION_TARGET_TYPES),
    ),
    check('copilot_action_items_status_chk', inList(t.status, COPILOT_ACTION_ITEM_STATUSES)),
    check('copilot_action_items_position_chk', sql`${t.position} >= 0`),
  ],
);

// ─── copilot_memory_entries ──────────────────────────────────────────────────────

export const copilotMemoryEntries = pgTable(
  'copilot_memory_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<CopilotMemoryKind>().notNull(),
    profileKey: text('profile_key').$type<CopilotMemoryProfileKey>(),
    content: text('content').notNull(),
    sourceType: text('source_type').$type<CopilotMemorySourceType>().notNull(),
    sourceLabel: text('source_label').notNull(),
    sourceRef: jsonb('source_ref').$type<CopilotJsonObject>(),
    status: text('status').$type<CopilotMemoryStatus>().notNull().default('active'),
    supersedesId: uuid('supersedes_id'),
    createdBy: uuid('created_by'),
    forgottenBy: uuid('forgotten_by'),
    forgottenAt: ts('forgotten_at'),
    /** Reservada (a v1 não usa): busca semântica de fatos. */
    embedding: vector('embedding', 1536),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_copilot_memory_entries_workspace_id').on(t.workspaceId, t.id),
    // Um perfil ativo por chave.
    uniqueIndex('uq_copilot_memory_active_profile')
      .on(t.workspaceId, t.profileKey)
      .where(sql`${t.kind} = 'profile' and ${t.status} = 'active'`),
    index('idx_copilot_memory_status_updated').on(
      t.workspaceId,
      t.status,
      t.updatedAt.desc(),
      t.id.desc(),
    ),
    index('idx_copilot_memory_supersedes')
      .on(t.supersedesId)
      .where(sql`${t.supersedesId} is not null`),
    foreignKey({
      name: 'copilot_memory_workspace_supersedes_fk',
      columns: [t.workspaceId, t.supersedesId],
      foreignColumns: [t.workspaceId, t.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'copilot_memory_workspace_created_by_fk',
      columns: [t.workspaceId, t.createdBy],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'copilot_memory_workspace_forgotten_by_fk',
      columns: [t.workspaceId, t.forgottenBy],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('set null'),
    check('copilot_memory_kind_chk', inList(t.kind, COPILOT_MEMORY_KINDS)),
    check(
      'copilot_memory_profile_key_chk',
      sql`${t.profileKey} is null or ${inList(t.profileKey, COPILOT_MEMORY_PROFILE_KEYS)}`,
    ),
    // Perfil sempre tem chave; fato nunca tem.
    check(
      'copilot_memory_kind_key_chk',
      sql`(${t.kind} = 'profile') = (${t.profileKey} is not null)`,
    ),
    check('copilot_memory_content_chk', sql`length(btrim(${t.content})) between 1 and 500`),
    check('copilot_memory_source_type_chk', inList(t.sourceType, COPILOT_MEMORY_SOURCE_TYPES)),
    check(
      'copilot_memory_source_label_chk',
      sql`char_length(btrim(${t.sourceLabel})) between 1 and 120`,
    ),
    check('copilot_memory_status_chk', inList(t.status, COPILOT_MEMORY_STATUSES)),
    check(
      'copilot_memory_forgotten_chk',
      sql`(${t.status} = 'forgotten') = (${t.forgottenAt} is not null)`,
    ),
    check(
      'copilot_memory_supersedes_self_chk',
      sql`${t.supersedesId} is null or ${t.supersedesId} <> ${t.id}`,
    ),
  ],
);

// ─── copilot_briefings ───────────────────────────────────────────────────────────

export const copilotBriefings = pgTable(
  'copilot_briefings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    /** Data local do membro (`YYYY-MM-DD`). */
    forDate: date('for_date', { mode: 'string' }).notNull(),
    generatedAt: ts('generated_at').notNull().defaultNow(),
    dataAsOf: ts('data_as_of').notNull(),
    /** ≤ 3 `BriefingItem` (validados no @hm/shared). */
    items: jsonb('items').$type<CopilotJsonObject[]>().notNull().default([]),
    overflowCount: integer('overflow_count').notNull().default(0),
    status: text('status').$type<CopilotBriefingStatus>().notNull(),
    pushSentAt: ts('push_sent_at'),
    seenAt: ts('seen_at'),
  },
  (t) => [
    uniqueIndex('uq_copilot_briefings_member_date').on(t.workspaceId, t.memberId, t.forDate),
    foreignKey({
      name: 'copilot_briefings_workspace_member_fk',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('cascade'),
    check('copilot_briefings_status_chk', inList(t.status, COPILOT_BRIEFING_STATUSES)),
    check(
      'copilot_briefings_items_chk',
      sql`case when jsonb_typeof(${t.items}) = 'array' then jsonb_array_length(${t.items}) <= 3 else false end`,
    ),
    check('copilot_briefings_overflow_chk', sql`${t.overflowCount} >= 0`),
  ],
);

// ─── copilot_autopilot_rules ─────────────────────────────────────────────────────

export const copilotAutopilotRules = pgTable(
  'copilot_autopilot_rules',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    stageId: uuid('stage_id').notNull(),
    mode: text('mode').$type<CopilotAutopilotMode>().notNull().default('off'),
    criteria: jsonb('criteria').$type<CopilotAutopilotCriteria>().notNull().default({}),
    dailyLimit: integer('daily_limit').notNull().default(10),
    enabledBy: uuid('enabled_by'),
    enabledAt: ts('enabled_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'copilot_autopilot_rules_pkey', columns: [t.workspaceId, t.stageId] }),
    index('idx_copilot_autopilot_rules_enabled_by')
      .on(t.workspaceId, t.enabledBy)
      .where(sql`${t.enabledBy} is not null`),
    foreignKey({
      name: 'copilot_autopilot_rules_workspace_stage_fk',
      columns: [t.workspaceId, t.stageId],
      foreignColumns: [stages.workspaceId, stages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'copilot_autopilot_rules_workspace_enabled_by_fk',
      columns: [t.workspaceId, t.enabledBy],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('set null'),
    check('copilot_autopilot_rules_mode_chk', inList(t.mode, COPILOT_AUTOPILOT_MODES)),
    check('copilot_autopilot_rules_criteria_chk', sql`jsonb_typeof(${t.criteria}) = 'object'`),
    check('copilot_autopilot_rules_daily_limit_chk', sql`${t.dailyLimit} between 1 and 50`),
  ],
);

// ─── copilot_suggestions ─────────────────────────────────────────────────────────

export const copilotSuggestions = pgTable(
  'copilot_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').notNull(),
    fromStageId: uuid('from_stage_id').notNull(),
    toStageId: uuid('to_stage_id').notNull(),
    reasonCode: text('reason_code').notNull(),
    /** Motivo em linguagem de negócio (modelo de texto, nunca "score 0,82"). */
    reasonText: text('reason_text').notNull(),
    confidence: text('confidence').$type<CopilotSuggestionConfidence>().notNull(),
    status: text('status').$type<CopilotSuggestionStatus>().notNull().default('pending'),
    proposalId: uuid('proposal_id'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Uma sugestão pendente por negócio (deal_id é global; a FK composta prende ao workspace).
    uniqueIndex('uq_copilot_suggestions_pending_deal')
      .on(t.dealId)
      .where(sql`${t.status} = 'pending'`),
    index('idx_copilot_suggestions_status_created').on(
      t.workspaceId,
      t.status,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('idx_copilot_suggestions_deal').on(t.dealId),
    index('idx_copilot_suggestions_from_stage').on(t.workspaceId, t.fromStageId),
    index('idx_copilot_suggestions_to_stage').on(t.workspaceId, t.toStageId),
    index('idx_copilot_suggestions_proposal')
      .on(t.proposalId)
      .where(sql`${t.proposalId} is not null`),
    foreignKey({
      name: 'copilot_suggestions_workspace_deal_fk',
      columns: [t.workspaceId, t.dealId],
      foreignColumns: [deals.workspaceId, deals.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'copilot_suggestions_workspace_from_stage_fk',
      columns: [t.workspaceId, t.fromStageId],
      foreignColumns: [stages.workspaceId, stages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'copilot_suggestions_workspace_to_stage_fk',
      columns: [t.workspaceId, t.toStageId],
      foreignColumns: [stages.workspaceId, stages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'copilot_suggestions_workspace_proposal_fk',
      columns: [t.workspaceId, t.proposalId],
      foreignColumns: [copilotActionProposals.workspaceId, copilotActionProposals.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'copilot_suggestions_workspace_decided_by_fk',
      columns: [t.workspaceId, t.decidedBy],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('set null'),
    check(
      'copilot_suggestions_confidence_chk',
      inList(t.confidence, COPILOT_SUGGESTION_CONFIDENCES),
    ),
    check('copilot_suggestions_status_chk', inList(t.status, COPILOT_SUGGESTION_STATUSES)),
    check('copilot_suggestions_stages_chk', sql`${t.fromStageId} <> ${t.toStageId}`),
    check(
      'copilot_suggestions_reason_code_chk',
      sql`char_length(${t.reasonCode}) between 1 and 64`,
    ),
    check(
      'copilot_suggestions_reason_text_chk',
      sql`char_length(btrim(${t.reasonText})) between 1 and 280`,
    ),
    // Aprovada/recusada sempre registram quando.
    check(
      'copilot_suggestions_decided_chk',
      sql`${t.status} not in ('approved','rejected') or ${t.decidedAt} is not null`,
    ),
  ],
);

// ─── Tipos ───────────────────────────────────────────────────────────────────────

export type CopilotSettingsRow = typeof copilotSettings.$inferSelect;
export type NewCopilotSettingsRow = typeof copilotSettings.$inferInsert;
export type CopilotMemberPrefsRow = typeof copilotMemberPrefs.$inferSelect;
export type NewCopilotMemberPrefsRow = typeof copilotMemberPrefs.$inferInsert;
export type CopilotSessionRow = typeof copilotSessions.$inferSelect;
export type NewCopilotSessionRow = typeof copilotSessions.$inferInsert;
export type CopilotMessageRow = typeof copilotMessages.$inferSelect;
export type NewCopilotMessageRow = typeof copilotMessages.$inferInsert;
export type CopilotTurnRow = typeof copilotTurns.$inferSelect;
export type NewCopilotTurnRow = typeof copilotTurns.$inferInsert;
export type CopilotToolCallRow = typeof copilotToolCalls.$inferSelect;
export type NewCopilotToolCallRow = typeof copilotToolCalls.$inferInsert;
export type CopilotProposalRow = typeof copilotActionProposals.$inferSelect;
export type NewCopilotProposalRow = typeof copilotActionProposals.$inferInsert;
export type CopilotActionItemRow = typeof copilotActionItems.$inferSelect;
export type NewCopilotActionItemRow = typeof copilotActionItems.$inferInsert;
export type CopilotMemoryEntryRow = typeof copilotMemoryEntries.$inferSelect;
export type NewCopilotMemoryEntryRow = typeof copilotMemoryEntries.$inferInsert;
export type CopilotBriefingRow = typeof copilotBriefings.$inferSelect;
export type NewCopilotBriefingRow = typeof copilotBriefings.$inferInsert;
export type CopilotAutopilotRuleRow = typeof copilotAutopilotRules.$inferSelect;
export type NewCopilotAutopilotRuleRow = typeof copilotAutopilotRules.$inferInsert;
export type CopilotSuggestionRow = typeof copilotSuggestions.$inferSelect;
export type NewCopilotSuggestionRow = typeof copilotSuggestions.$inferInsert;
