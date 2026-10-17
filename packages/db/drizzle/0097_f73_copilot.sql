-- F73-S01 — schema do Copiloto (sessões, turnos, propostas, memória, briefing, piloto automático).
-- Spec: docs/features/COPILOTO.md §4 e §6.3 · ADR-003 (identidade do membro) · ADR-004 (motor de
-- ações). Schema Drizzle: packages/db/src/schema/copilot.ts (+ audit_logs em schema/index.ts e
-- llm_usage_logs em schema/llm.ts).
--
-- ─── O que muda ─────────────────────────────────────────────────────────────────
-- 1. `deals` ganha `uq_deals_workspace_id (workspace_id, id)`: alvo da FK composta de
--    copilot_suggestions (padrão da F70-S12; members/stages já têm o seu desde a 0085).
-- 2. `audit_logs`: requested_by_member_id (FK composta → members, SET NULL só da coluna),
--    copilot_proposal_id e copilot_turn_id (correlação, sem FK: a trilha sobrevive à retenção do
--    histórico do Copiloto); `audit_logs_actor_type_chk` passa a aceitar 'copilot' e 'autopilot';
--    índices parciais (workspace_id, copilot_proposal_id) e (workspace_id, requested_by_member_id).
-- 3. `llm_usage_logs`: surface text NOT NULL DEFAULT 'agent' ('agent'|'copilot') e
--    copilot_turn_id (sem FK, idem); índice (workspace_id, surface, created_at DESC).
--    ADD COLUMN com default constante é só metadado (PG ≥ 11): nenhuma linha é reescrita, e todo
--    produtor existente continua gravando 'agent' sem mudar uma linha de código.
-- 4. 12 tabelas novas, todas com RLS ENABLE + FORCE e policy `<tabela>_isolation` por
--    app_current_workspace() (USING + WITH CHECK). O papel hm_app recebe os grants pelo
--    ALTER DEFAULT PRIVILEGES. Toda referência a entidade tenant é FK composta
--    (workspace_id, x_id) → alvo (workspace_id, id); nas anuláveis, ON DELETE SET NULL (coluna).
--    `deal_history.actor_type` NÃO muda (a origem "copiloto" vai em metadata.via, spec §4).
--
-- ─── Locks ──────────────────────────────────────────────────────────────────────
-- audit_logs, llm_usage_logs e deals recebem índice sem CONCURRENTLY (o migrator roda numa
-- transação) e o CHECK novo valida a tabela inteira: as escritas nessas tabelas esperam o COMMIT.
-- O lock_timeout faz a migração falhar rápido em vez de enfileirar o tráfego atrás dela.
--
-- Idempotente: IF NOT EXISTS em tabelas/colunas/índices, guardas em pg_constraint para as
-- constraints adicionadas a tabelas existentes, DROP POLICY IF EXISTS antes de cada policy.
--
-- ─── Reverter (down) ────────────────────────────────────────────────────────────
-- Perde todo o histórico do Copiloto. Rodar na ordem:
--   DROP TABLE IF EXISTS copilot_suggestions, copilot_autopilot_rules, copilot_briefings,
--     copilot_memory_entries, copilot_action_items, copilot_tool_calls, copilot_messages,
--     copilot_action_proposals, copilot_turns, copilot_sessions, copilot_member_prefs,
--     copilot_settings;
--   DROP INDEX IF EXISTS idx_llm_usage_workspace_surface_created, idx_llm_usage_copilot_turn;
--   ALTER TABLE llm_usage_logs DROP CONSTRAINT IF EXISTS llm_usage_logs_surface_chk,
--     DROP COLUMN IF EXISTS copilot_turn_id, DROP COLUMN IF EXISTS surface;
--   DROP INDEX IF EXISTS idx_audit_logs_copilot_proposal, idx_audit_logs_requested_by;
--   DELETE FROM audit_logs WHERE actor_type IN ('copilot','autopilot');  -- ou remapear p/ 'system'
--   ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_type_chk,
--     DROP CONSTRAINT IF EXISTS audit_logs_workspace_requested_by_fk,
--     DROP COLUMN IF EXISTS copilot_turn_id, DROP COLUMN IF EXISTS copilot_proposal_id,
--     DROP COLUMN IF EXISTS requested_by_member_id;
--   ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_type_chk
--     CHECK (actor_type IN ('member','agent','api','system','platform_admin'));
--   DROP INDEX IF EXISTS uq_deals_workspace_id;
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1781452858000;

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint

-- ─── 1. deals (alvo de FK composta) ─────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_deals_workspace_id ON deals (workspace_id, id);
--> statement-breakpoint

-- ─── 2. audit_logs ──────────────────────────────────────────────────────────────
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS requested_by_member_id uuid,
  ADD COLUMN IF NOT EXISTS copilot_proposal_id uuid,
  ADD COLUMN IF NOT EXISTS copilot_turn_id uuid;
--> statement-breakpoint
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_type_chk;
--> statement-breakpoint
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_actor_type_chk
  CHECK (actor_type IN ('member','agent','api','system','platform_admin','copilot','autopilot'));
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_workspace_requested_by_fk') THEN
    ALTER TABLE audit_logs
      ADD CONSTRAINT audit_logs_workspace_requested_by_fk
      FOREIGN KEY (workspace_id, requested_by_member_id) REFERENCES members (workspace_id, id)
      ON DELETE SET NULL (requested_by_member_id);
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_audit_logs_copilot_proposal
  ON audit_logs (workspace_id, copilot_proposal_id) WHERE copilot_proposal_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_audit_logs_requested_by
  ON audit_logs (workspace_id, requested_by_member_id) WHERE requested_by_member_id IS NOT NULL;
--> statement-breakpoint
COMMENT ON COLUMN audit_logs.requested_by_member_id IS
  'F73-S01: quem pediu a ação. actor_member_id = membro cujas permissões foram usadas; diferem só no fluxo de aprovação.';
--> statement-breakpoint

-- ─── 3. llm_usage_logs ──────────────────────────────────────────────────────────
ALTER TABLE llm_usage_logs
  ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'agent',
  ADD COLUMN IF NOT EXISTS copilot_turn_id uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'llm_usage_logs_surface_chk') THEN
    ALTER TABLE llm_usage_logs
      ADD CONSTRAINT llm_usage_logs_surface_chk CHECK (surface IN ('agent','copilot'));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_llm_usage_workspace_surface_created
  ON llm_usage_logs (workspace_id, surface, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_llm_usage_copilot_turn
  ON llm_usage_logs (copilot_turn_id) WHERE copilot_turn_id IS NOT NULL;
--> statement-breakpoint
COMMENT ON COLUMN llm_usage_logs.surface IS
  'F73-S01: agent = atendimento (teto dos agentes soma só esta); copilot = Copiloto (orçamento próprio).';
--> statement-breakpoint

-- ─── 4.1 copilot_settings (1:1 workspace) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS copilot_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  capability_matrix jsonb NOT NULL DEFAULT '{}'::jsonb,
  monthly_budget_usd numeric(10,2) NOT NULL DEFAULT 30.00,
  budget_mode text NOT NULL DEFAULT 'queries_only',
  budget_alert_pct integer NOT NULL DEFAULT 80,
  history_retention_months integer NOT NULL DEFAULT 12,
  default_auto_open text NOT NULL DEFAULT 'daily',
  partner_access boolean NOT NULL DEFAULT false,
  model text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilot_settings_workspace_updated_by_fk
    FOREIGN KEY (workspace_id, updated_by) REFERENCES members (workspace_id, id)
    ON DELETE SET NULL (updated_by),
  CONSTRAINT copilot_settings_budget_mode_chk CHECK (budget_mode IN ('queries_only','pause')),
  CONSTRAINT copilot_settings_default_auto_open_chk
    CHECK (default_auto_open IN ('always','daily','never')),
  CONSTRAINT copilot_settings_history_retention_chk
    CHECK (history_retention_months IN (6,12,24)),
  CONSTRAINT copilot_settings_budget_chk CHECK (monthly_budget_usd >= 0),
  CONSTRAINT copilot_settings_alert_pct_chk CHECK (budget_alert_pct BETWEEN 1 AND 100),
  CONSTRAINT copilot_settings_matrix_chk CHECK (jsonb_typeof(capability_matrix) = 'object'),
  CONSTRAINT copilot_settings_model_chk
    CHECK (model IS NULL OR char_length(model) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_settings_updated_by
  ON copilot_settings (workspace_id, updated_by) WHERE updated_by IS NOT NULL;
--> statement-breakpoint

-- ─── 4.2 copilot_member_prefs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copilot_member_prefs (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  auto_open text,
  briefing_last_seen_on date,
  surface text NOT NULL DEFAULT 'bubble',
  first_use_hint_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilot_member_prefs_pkey PRIMARY KEY (workspace_id, member_id),
  CONSTRAINT copilot_member_prefs_workspace_member_fk
    FOREIGN KEY (workspace_id, member_id) REFERENCES members (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT copilot_member_prefs_auto_open_chk
    CHECK (auto_open IS NULL OR auto_open IN ('always','daily','never')),
  CONSTRAINT copilot_member_prefs_surface_chk CHECK (surface IN ('bubble','docked'))
);
--> statement-breakpoint

-- ─── 4.3 copilot_sessions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copilot_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  title text,
  origin text NOT NULL,
  last_page_context jsonb,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilot_sessions_workspace_member_fk
    FOREIGN KEY (workspace_id, member_id) REFERENCES members (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT copilot_sessions_origin_chk
    CHECK (origin IN ('bubble','docked','fullscreen','palette','briefing','mobile')),
  CONSTRAINT copilot_sessions_title_chk
    CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_copilot_sessions_workspace_id
  ON copilot_sessions (workspace_id, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_sessions_member_updated
  ON copilot_sessions (workspace_id, member_id, updated_at DESC, id DESC);
--> statement-breakpoint

-- ─── 4.4 copilot_turns ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copilot_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  session_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  grant_nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  tool_calls integer NOT NULL DEFAULT 0,
  max_tool_calls integer NOT NULL,
  tainted boolean NOT NULL DEFAULT false,
  model text,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,8) NOT NULL DEFAULT 0,
  iterations integer NOT NULL DEFAULT 0,
  error_code text,
  client_request_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT copilot_turns_workspace_member_fk
    FOREIGN KEY (workspace_id, member_id) REFERENCES members (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT copilot_turns_workspace_session_fk
    FOREIGN KEY (workspace_id, session_id) REFERENCES copilot_sessions (workspace_id, id)
    ON DELETE CASCADE,
  CONSTRAINT copilot_turns_status_chk
    CHECK (status IN ('running','completed','failed','cancelled','budget_blocked','rate_limited')),
  CONSTRAINT copilot_turns_nonce_chk CHECK (char_length(grant_nonce) BETWEEN 16 AND 128),
  CONSTRAINT copilot_turns_max_tool_calls_chk CHECK (max_tool_calls BETWEEN 1 AND 64),
  CONSTRAINT copilot_turns_tool_calls_chk CHECK (tool_calls >= 0 AND tool_calls <= max_tool_calls),
  CONSTRAINT copilot_turns_usage_chk
    CHECK (prompt_tokens >= 0 AND completion_tokens >= 0 AND iterations >= 0 AND cost_usd >= 0),
  CONSTRAINT copilot_turns_client_request_chk
    CHECK (client_request_id IS NULL OR char_length(client_request_id) BETWEEN 1 AND 128),
  CONSTRAINT copilot_turns_completed_chk CHECK ((status = 'running') = (completed_at IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_copilot_turns_workspace_id ON copilot_turns (workspace_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_copilot_turns_client_request
  ON copilot_turns (workspace_id, member_id, client_request_id) WHERE client_request_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_turns_member_started
  ON copilot_turns (member_id, started_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_turns_running
  ON copilot_turns (workspace_id, member_id) WHERE status = 'running';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_turns_session ON copilot_turns (session_id);
--> statement-breakpoint

-- ─── 4.5 copilot_action_proposals ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copilot_action_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid,
  turn_id uuid,
  source text NOT NULL DEFAULT 'copilot',
  capability text NOT NULL,
  risk_level smallint NOT NULL,
  status text NOT NULL,
  requested_by_member_id uuid,
  executed_as_member_id uuid,
  approver_member_id uuid,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_checks jsonb,
  blocked_reason text,
  summary text NOT NULL,
  confirm_idempotency_key text,
  expires_at timestamptz,
  confirmed_at timestamptz,
  executed_at timestamptz,
  completed_at timestamptz,
  lease_expires_at timestamptz,
  stop_requested boolean NOT NULL DEFAULT false,
  undo_deadline timestamptz,
  undone_at timestamptz,
  undone_by uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilot_proposals_workspace_session_fk
    FOREIGN KEY (workspace_id, session_id) REFERENCES copilot_sessions (workspace_id, id)
    ON DELETE SET NULL (session_id),
  CONSTRAINT copilot_proposals_workspace_turn_fk
    FOREIGN KEY (workspace_id, turn_id) REFERENCES copilot_turns (workspace_id, id)
    ON DELETE SET NULL (turn_id),
  CONSTRAINT copilot_proposals_workspace_requested_by_fk
    FOREIGN KEY (workspace_id, requested_by_member_id) REFERENCES members (workspace_id, id)
    ON DELETE SET NULL (requested_by_member_id),
  CONSTRAINT copilot_proposals_workspace_executed_as_fk
    FOREIGN KEY (workspace_id, executed_as_member_id) REFERENCES members (workspace_id, id)
    ON DELETE SET NULL (executed_as_member_id),
  CONSTRAINT copilot_proposals_workspace_approver_fk
    FOREIGN KEY (workspace_id, approver_member_id) REFERENCES members (workspace_id, id)
    ON DELETE SET NULL (approver_member_id),
  CONSTRAINT copilot_proposals_workspace_undone_by_fk
    FOREIGN KEY (workspace_id, undone_by) REFERENCES members (workspace_id, id)
    ON DELETE SET NULL (undone_by),
  CONSTRAINT copilot_proposals_source_chk CHECK (source IN ('copilot','autopilot')),
  CONSTRAINT copilot_proposals_status_chk CHECK (status IN (
    'proposed','blocked','awaiting_approval','expired','cancelled','confirmed','executing',
    'completed','partially_completed','failed','undone','partially_undone'
  )),
  CONSTRAINT copilot_proposals_risk_level_chk CHECK (risk_level BETWEEN 1 AND 4),
  CONSTRAINT copilot_proposals_blocked_reason_chk CHECK (
    blocked_reason IS NULL
    OR blocked_reason IN ('role','capability_disabled','subscription_inactive','budget','scope')
  ),
  CONSTRAINT copilot_proposals_blocked_has_reason_chk
    CHECK (status <> 'blocked' OR blocked_reason IS NOT NULL),
  CONSTRAINT copilot_proposals_open_expires_chk
    CHECK (status NOT IN ('proposed','awaiting_approval') OR expires_at IS NOT NULL),
  CONSTRAINT copilot_proposals_executing_lease_chk
    CHECK (status <> 'executing' OR lease_expires_at IS NOT NULL),
  CONSTRAINT copilot_proposals_capability_chk CHECK (char_length(capability) BETWEEN 1 AND 80),
  CONSTRAINT copilot_proposals_summary_chk CHECK (char_length(btrim(summary)) BETWEEN 1 AND 500),
  CONSTRAINT copilot_proposals_idempotency_key_chk CHECK (
    confirm_idempotency_key IS NULL OR char_length(confirm_idempotency_key) BETWEEN 1 AND 128
  ),
  CONSTRAINT copilot_proposals_version_chk CHECK (version >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_copilot_action_proposals_workspace_id
  ON copilot_action_proposals (workspace_id, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_proposals_workspace_created
  ON copilot_action_proposals (workspace_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_proposals_requester_created
  ON copilot_action_proposals (workspace_id, requested_by_member_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_proposals_open_expires
  ON copilot_action_proposals (status, expires_at)
  WHERE status IN ('proposed','awaiting_approval');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_proposals_executing_lease
  ON copilot_action_proposals (status, lease_expires_at) WHERE status = 'executing';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_proposals_approver
  ON copilot_action_proposals (workspace_id, approver_member_id) WHERE approver_member_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_proposals_executed_as
  ON copilot_action_proposals (workspace_id, executed_as_member_id)
  WHERE executed_as_member_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_proposals_undone_by
  ON copilot_action_proposals (workspace_id, undone_by) WHERE undone_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_proposals_session
  ON copilot_action_proposals (session_id) WHERE session_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_proposals_turn
  ON copilot_action_proposals (turn_id) WHERE turn_id IS NOT NULL;
--> statement-breakpoint

-- ─── 4.6 copilot_messages ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copilot_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  turn_id uuid,
  role text NOT NULL,
  content text NOT NULL,
  blocks jsonb,
  tool_results jsonb,
  page_context jsonb,
  proposal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilot_messages_workspace_session_fk
    FOREIGN KEY (workspace_id, session_id) REFERENCES copilot_sessions (workspace_id, id)
    ON DELETE CASCADE,
  CONSTRAINT copilot_messages_workspace_turn_fk
    FOREIGN KEY (workspace_id, turn_id) REFERENCES copilot_turns (workspace_id, id)
    ON DELETE SET NULL (turn_id),
  CONSTRAINT copilot_messages_workspace_proposal_fk
    FOREIGN KEY (workspace_id, proposal_id) REFERENCES copilot_action_proposals (workspace_id, id)
    ON DELETE SET NULL (proposal_id),
  CONSTRAINT copilot_messages_role_chk CHECK (role IN ('user','assistant','event')),
  CONSTRAINT copilot_messages_content_chk CHECK (char_length(content) <= 32000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_messages_session_created
  ON copilot_messages (session_id, created_at, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_messages_turn
  ON copilot_messages (turn_id) WHERE turn_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_messages_proposal
  ON copilot_messages (proposal_id) WHERE proposal_id IS NOT NULL;
--> statement-breakpoint

-- ─── 4.7 copilot_tool_calls ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copilot_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  turn_id uuid NOT NULL,
  member_id uuid NOT NULL,
  tool_key text NOT NULL,
  args_redacted jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision text NOT NULL,
  risk_level smallint,
  error_code text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilot_tool_calls_workspace_turn_fk
    FOREIGN KEY (workspace_id, turn_id) REFERENCES copilot_turns (workspace_id, id)
    ON DELETE CASCADE,
  CONSTRAINT copilot_tool_calls_workspace_member_fk
    FOREIGN KEY (workspace_id, member_id) REFERENCES members (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT copilot_tool_calls_decision_chk
    CHECK (decision IN ('executed','proposed','blocked','denied','invalid_args','error')),
  CONSTRAINT copilot_tool_calls_risk_level_chk
    CHECK (risk_level IS NULL OR risk_level BETWEEN 1 AND 4),
  CONSTRAINT copilot_tool_calls_tool_key_chk CHECK (char_length(tool_key) BETWEEN 1 AND 80),
  CONSTRAINT copilot_tool_calls_duration_chk CHECK (duration_ms IS NULL OR duration_ms >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_tool_calls_turn ON copilot_tool_calls (turn_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_tool_calls_workspace_created
  ON copilot_tool_calls (workspace_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_tool_calls_member
  ON copilot_tool_calls (workspace_id, member_id);
--> statement-breakpoint

-- ─── 4.8 copilot_action_items ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copilot_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL,
  position integer NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  expected_version text,
  before jsonb,
  after jsonb,
  undo_payload jsonb,
  error_code text,
  executed_at timestamptz,
  undone_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilot_action_items_workspace_proposal_fk
    FOREIGN KEY (workspace_id, proposal_id) REFERENCES copilot_action_proposals (workspace_id, id)
    ON DELETE CASCADE,
  CONSTRAINT copilot_action_items_target_type_chk
    CHECK (target_type IN ('deal','contact','conversation','event','campaign','message')),
  CONSTRAINT copilot_action_items_status_chk CHECK (status IN (
    'pending','done','skipped_conflict','skipped_policy','failed','undone','undo_conflict','excluded'
  )),
  CONSTRAINT copilot_action_items_position_chk CHECK (position >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_copilot_action_items_proposal_position
  ON copilot_action_items (proposal_id, position);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_copilot_action_items_proposal_target
  ON copilot_action_items (proposal_id, target_type, target_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_action_items_target
  ON copilot_action_items (workspace_id, target_type, target_id);
--> statement-breakpoint

-- ─── 4.9 copilot_memory_entries ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copilot_memory_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL,
  profile_key text,
  content text NOT NULL,
  source_type text NOT NULL,
  source_label text NOT NULL,
  source_ref jsonb,
  status text NOT NULL DEFAULT 'active',
  supersedes_id uuid,
  created_by uuid,
  forgotten_by uuid,
  forgotten_at timestamptz,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilot_memory_workspace_created_by_fk
    FOREIGN KEY (workspace_id, created_by) REFERENCES members (workspace_id, id)
    ON DELETE SET NULL (created_by),
  CONSTRAINT copilot_memory_workspace_forgotten_by_fk
    FOREIGN KEY (workspace_id, forgotten_by) REFERENCES members (workspace_id, id)
    ON DELETE SET NULL (forgotten_by),
  CONSTRAINT copilot_memory_kind_chk CHECK (kind IN ('profile','fact')),
  CONSTRAINT copilot_memory_profile_key_chk CHECK (
    profile_key IS NULL
    OR profile_key IN ('what_we_sell','avg_ticket','tone','hours','commercial_rules')
  ),
  CONSTRAINT copilot_memory_kind_key_chk CHECK ((kind = 'profile') = (profile_key IS NOT NULL)),
  CONSTRAINT copilot_memory_content_chk CHECK (length(btrim(content)) BETWEEN 1 AND 500),
  CONSTRAINT copilot_memory_source_type_chk
    CHECK (source_type IN ('member','copilot','integration')),
  CONSTRAINT copilot_memory_source_label_chk
    CHECK (char_length(btrim(source_label)) BETWEEN 1 AND 120),
  CONSTRAINT copilot_memory_status_chk CHECK (status IN ('active','forgotten','superseded')),
  CONSTRAINT copilot_memory_forgotten_chk CHECK ((status = 'forgotten') = (forgotten_at IS NOT NULL)),
  CONSTRAINT copilot_memory_supersedes_self_chk CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_copilot_memory_entries_workspace_id
  ON copilot_memory_entries (workspace_id, id);
--> statement-breakpoint
DO $$
BEGIN
  -- Auto-referência: precisa do índice (workspace_id, id) acima.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'copilot_memory_workspace_supersedes_fk') THEN
    ALTER TABLE copilot_memory_entries
      ADD CONSTRAINT copilot_memory_workspace_supersedes_fk
      FOREIGN KEY (workspace_id, supersedes_id) REFERENCES copilot_memory_entries (workspace_id, id)
      ON DELETE SET NULL (supersedes_id);
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_copilot_memory_active_profile
  ON copilot_memory_entries (workspace_id, profile_key)
  WHERE kind = 'profile' AND status = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_memory_status_updated
  ON copilot_memory_entries (workspace_id, status, updated_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_memory_supersedes
  ON copilot_memory_entries (supersedes_id) WHERE supersedes_id IS NOT NULL;
--> statement-breakpoint

-- ─── 4.10 copilot_briefings ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copilot_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  for_date date NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  data_as_of timestamptz NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  overflow_count integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  push_sent_at timestamptz,
  seen_at timestamptz,
  CONSTRAINT copilot_briefings_workspace_member_fk
    FOREIGN KEY (workspace_id, member_id) REFERENCES members (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT copilot_briefings_status_chk CHECK (status IN ('ready','empty','stale','failed')),
  CONSTRAINT copilot_briefings_items_chk CHECK (
    CASE WHEN jsonb_typeof(items) = 'array' THEN jsonb_array_length(items) <= 3 ELSE false END
  ),
  CONSTRAINT copilot_briefings_overflow_chk CHECK (overflow_count >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_copilot_briefings_member_date
  ON copilot_briefings (workspace_id, member_id, for_date);
--> statement-breakpoint

-- ─── 4.11 copilot_autopilot_rules ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copilot_autopilot_rules (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL,
  mode text NOT NULL DEFAULT 'off',
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  daily_limit integer NOT NULL DEFAULT 10,
  enabled_by uuid,
  enabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilot_autopilot_rules_pkey PRIMARY KEY (workspace_id, stage_id),
  CONSTRAINT copilot_autopilot_rules_workspace_stage_fk
    FOREIGN KEY (workspace_id, stage_id) REFERENCES stages (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT copilot_autopilot_rules_workspace_enabled_by_fk
    FOREIGN KEY (workspace_id, enabled_by) REFERENCES members (workspace_id, id)
    ON DELETE SET NULL (enabled_by),
  CONSTRAINT copilot_autopilot_rules_mode_chk
    CHECK (mode IN ('off','suggest','daily_approval','auto')),
  CONSTRAINT copilot_autopilot_rules_criteria_chk CHECK (jsonb_typeof(criteria) = 'object'),
  CONSTRAINT copilot_autopilot_rules_daily_limit_chk CHECK (daily_limit BETWEEN 1 AND 50)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_autopilot_rules_enabled_by
  ON copilot_autopilot_rules (workspace_id, enabled_by) WHERE enabled_by IS NOT NULL;
--> statement-breakpoint

-- ─── 4.12 copilot_suggestions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copilot_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL,
  from_stage_id uuid NOT NULL,
  to_stage_id uuid NOT NULL,
  reason_code text NOT NULL,
  reason_text text NOT NULL,
  confidence text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  proposal_id uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilot_suggestions_workspace_deal_fk
    FOREIGN KEY (workspace_id, deal_id) REFERENCES deals (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT copilot_suggestions_workspace_from_stage_fk
    FOREIGN KEY (workspace_id, from_stage_id) REFERENCES stages (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT copilot_suggestions_workspace_to_stage_fk
    FOREIGN KEY (workspace_id, to_stage_id) REFERENCES stages (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT copilot_suggestions_workspace_proposal_fk
    FOREIGN KEY (workspace_id, proposal_id) REFERENCES copilot_action_proposals (workspace_id, id)
    ON DELETE SET NULL (proposal_id),
  CONSTRAINT copilot_suggestions_workspace_decided_by_fk
    FOREIGN KEY (workspace_id, decided_by) REFERENCES members (workspace_id, id)
    ON DELETE SET NULL (decided_by),
  CONSTRAINT copilot_suggestions_confidence_chk CHECK (confidence IN ('high','medium','low')),
  CONSTRAINT copilot_suggestions_status_chk CHECK (status IN (
    'pending','approved','rejected','expired','superseded','auto_applied'
  )),
  CONSTRAINT copilot_suggestions_stages_chk CHECK (from_stage_id <> to_stage_id),
  CONSTRAINT copilot_suggestions_reason_code_chk CHECK (char_length(reason_code) BETWEEN 1 AND 64),
  CONSTRAINT copilot_suggestions_reason_text_chk
    CHECK (char_length(btrim(reason_text)) BETWEEN 1 AND 280),
  CONSTRAINT copilot_suggestions_decided_chk
    CHECK (status NOT IN ('approved','rejected') OR decided_at IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_copilot_suggestions_pending_deal
  ON copilot_suggestions (deal_id) WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_suggestions_status_created
  ON copilot_suggestions (workspace_id, status, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_suggestions_deal ON copilot_suggestions (deal_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_suggestions_from_stage
  ON copilot_suggestions (workspace_id, from_stage_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_suggestions_to_stage
  ON copilot_suggestions (workspace_id, to_stage_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_copilot_suggestions_proposal
  ON copilot_suggestions (proposal_id) WHERE proposal_id IS NOT NULL;
--> statement-breakpoint

-- ─── 5. RLS (ENABLE + FORCE + isolamento por workspace) ─────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'copilot_settings', 'copilot_member_prefs', 'copilot_sessions', 'copilot_messages',
    'copilot_turns', 'copilot_tool_calls', 'copilot_action_proposals', 'copilot_action_items',
    'copilot_memory_entries', 'copilot_briefings', 'copilot_autopilot_rules', 'copilot_suggestions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (workspace_id = app_current_workspace()) '
      'WITH CHECK (workspace_id = app_current_workspace())',
      t || '_isolation', t
    );
  END LOOP;
END $$;
--> statement-breakpoint

SET LOCAL lock_timeout TO DEFAULT;
