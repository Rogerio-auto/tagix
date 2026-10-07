-- F71-S01 — convites de membros, membership por pessoa e trial de 15 dias.
-- Spec: docs/features/CONTAS_E_CONVITES.md §4 (modelo) e §6 (threat model).
--
-- ─── O que muda ─────────────────────────────────────────────────────────────────
-- 1. `members` ganha:
--      last_active_at    — última entrada/troca para a empresa; decide a empresa padrão no login;
--      terms_accepted_at — aceite de termos/privacidade (LGPD), gravado no OWNER pelo signup;
--      terms_version     — versão do texto aceito. Os dois juntos ou nenhum (members_terms_chk).
-- 2. `member_invites` (nova, RLS por workspace_id, FORCE): o convite deixa de ser uma linha de
--    `members` com auth_user_id aleatório. Token só como sha256 hex (T1); OWNER fora (T4); um
--    pendente por (workspace_id, email); token_hash único.
--    `invited_by`, `accepted_member_id` e `department_id` usam FK composta por workspace (padrão
--    da F70-S12): a checagem de FK roda fora da RLS e a composta obriga o alvo a ser do mesmo
--    workspace. `ON DELETE SET NULL (coluna)` anula só a referência (sem a lista, o Postgres
--    anularia também workspace_id, NOT NULL). Para isso `departments` ganha (workspace_id, id).
-- 3. Dados:
--    a. "Convites" antigos (`members` status='invited' com invited_by) viram convites pendentes
--       e saem de `members`. O token deles nunca existiu: o hash vira `legacy:<sha256 de um
--       valor aleatório descartado>`. O prefixo deixa o valor fora do formato de um sha256 hex,
--       então NENHUM token chega nele (inutilizável por construção, não só por segredo). O admin
--       reenvia pela UI, que troca o token. Papel OWNER (o código antigo permitia, B7) vira ADMIN.
--       O OWNER do signup (status 'invited' pré-verify) tem invited_by NULL e não é tocado.
--    b. Trial sem fim: `workspaces`/`subscriptions` em 'trial' com trial_ends_at NULL recebem
--       now() + 15 dias, alinhando com a outra tabela quando ela já tem data.
--       ANTES DO DEPLOY: rodar a query de prévia da nota de execução do F71-S01 e estender pelo
--       painel as empresas reais que não podem expirar.
--
-- ─── Locks ──────────────────────────────────────────────────────────────────────
-- `members` em SHARE ROW EXCLUSIVE durante a migração: a API antiga não cria um "convite" novo
-- entre a cópia e a remoção. Escritas em members esperam o COMMIT (tabela pequena). O
-- lock_timeout faz a migração falhar rápido em vez de enfileirar o tráfego atrás dela.
--
-- Idempotente: IF NOT EXISTS, guardas em pg_constraint, DROP POLICY IF EXISTS; os passos de
-- dado só pegam o que ainda não foi migrado (rodar de novo não faz nada).
--
-- Reverter (perde os convites criados depois do deploy):
--   DROP TABLE IF EXISTS member_invites;
--   DROP INDEX IF EXISTS uq_departments_workspace_id;
--   ALTER TABLE members DROP CONSTRAINT IF EXISTS members_terms_chk,
--     DROP COLUMN IF EXISTS terms_version, DROP COLUMN IF EXISTS terms_accepted_at,
--     DROP COLUMN IF EXISTS last_active_at;
--   (o backfill do trial não é revertido: as datas ficam, o código antigo as ignora)

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
LOCK TABLE members IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

-- ─── 1. members ─────────────────────────────────────────────────────────────────
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_terms_chk') THEN
    ALTER TABLE members
      ADD CONSTRAINT members_terms_chk CHECK (
        (terms_accepted_at IS NULL) = (terms_version IS NULL)
        AND (terms_version IS NULL OR length(terms_version) BETWEEN 1 AND 64)
      );
  END IF;
END $$;
--> statement-breakpoint

-- ─── 2. member_invites ──────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_departments_workspace_id ON departments (workspace_id, id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS member_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email citext NOT NULL,
  role text NOT NULL,
  department_id uuid,
  token_hash text NOT NULL,
  invited_by uuid,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  accepted_member_id uuid,
  last_sent_at timestamptz,
  send_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_invites_token_hash ON member_invites (token_hash);
--> statement-breakpoint
-- Um convite pendente por pessoa por empresa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_invites_pending_email
  ON member_invites (workspace_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
--> statement-breakpoint
-- Banner "você foi convidado" (GET /api/me/invites): pendentes pelo email da sessão.
CREATE INDEX IF NOT EXISTS idx_member_invites_pending_by_email
  ON member_invites (email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_member_invites_workspace_created
  ON member_invites (workspace_id, created_at DESC);
--> statement-breakpoint
-- Alvos do SET NULL quando um membro/departamento é apagado (sem eles, scan da tabela).
CREATE INDEX IF NOT EXISTS idx_member_invites_invited_by
  ON member_invites (invited_by) WHERE invited_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_member_invites_accepted_member
  ON member_invites (accepted_member_id) WHERE accepted_member_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_member_invites_department
  ON member_invites (department_id) WHERE department_id IS NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_invites_role_chk') THEN
    -- Sem OWNER (PERMISSIONS §7, T4) e sem papel fora do domínio.
    ALTER TABLE member_invites
      ADD CONSTRAINT member_invites_role_chk
      CHECK (role IN ('ADMIN','SUPERVISOR','AGENT','READONLY'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_invites_token_hash_chk') THEN
    ALTER TABLE member_invites
      ADD CONSTRAINT member_invites_token_hash_chk
      CHECK (token_hash ~ '^(legacy:)?[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_invites_send_count_chk') THEN
    ALTER TABLE member_invites
      ADD CONSTRAINT member_invites_send_count_chk CHECK (send_count >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_invites_final_state_chk') THEN
    -- Aceito e revogado são estados finais excludentes.
    ALTER TABLE member_invites
      ADD CONSTRAINT member_invites_final_state_chk
      CHECK (NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_invites_accepted_member_chk') THEN
    ALTER TABLE member_invites
      ADD CONSTRAINT member_invites_accepted_member_chk
      CHECK (accepted_member_id IS NULL OR accepted_at IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_invites_workspace_department_fk') THEN
    ALTER TABLE member_invites
      ADD CONSTRAINT member_invites_workspace_department_fk
      FOREIGN KEY (workspace_id, department_id) REFERENCES departments (workspace_id, id)
      ON DELETE SET NULL (department_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_invites_workspace_invited_by_fk') THEN
    ALTER TABLE member_invites
      ADD CONSTRAINT member_invites_workspace_invited_by_fk
      FOREIGN KEY (workspace_id, invited_by) REFERENCES members (workspace_id, id)
      ON DELETE SET NULL (invited_by);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_invites_workspace_accepted_member_fk') THEN
    ALTER TABLE member_invites
      ADD CONSTRAINT member_invites_workspace_accepted_member_fk
      FOREIGN KEY (workspace_id, accepted_member_id) REFERENCES members (workspace_id, id)
      ON DELETE SET NULL (accepted_member_id);
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE member_invites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE member_invites FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS member_invites_isolation ON member_invites;
--> statement-breakpoint
CREATE POLICY member_invites_isolation ON member_invites
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
COMMENT ON COLUMN member_invites.token_hash IS
  'F71-S01: sha256 hex do token do link; o token em claro nunca é gravado. legacy:<hex> = convite migrado, inutilizável até o reenvio.';
--> statement-breakpoint

-- ─── 3a. Convites antigos → member_invites ──────────────────────────────────────
DO $$
DECLARE
  n_owner bigint;
BEGIN
  SELECT count(*) INTO n_owner
    FROM members WHERE status = 'invited' AND invited_by IS NOT NULL AND role = 'OWNER';
  IF n_owner > 0 THEN
    RAISE NOTICE 'F71-S01: % convite(s) antigo(s) com papel OWNER migrado(s) como ADMIN', n_owner;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO member_invites (
  workspace_id, email, role, token_hash, invited_by, expires_at, send_count, last_sent_at, created_at
)
SELECT
  m.workspace_id,
  m.email,
  CASE WHEN m.role = 'OWNER' THEN 'ADMIN' ELSE m.role END,
  'legacy:' || encode(
    sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || m.id::text, 'UTF8')),
    'hex'
  ),
  -- Só quem convidou e continua membro de verdade da MESMA empresa (os outros "convites" saem
  -- de members logo abaixo; a FK composta exige o mesmo workspace).
  CASE
    WHEN EXISTS (
      SELECT 1 FROM members i
       WHERE i.id = m.invited_by
         AND i.workspace_id = m.workspace_id
         AND NOT (i.status = 'invited' AND i.invited_by IS NOT NULL)
    ) THEN m.invited_by
  END,
  now() + interval '7 days',
  0,
  NULL,
  coalesce(m.invited_at, m.created_at)
FROM members m
WHERE m.status = 'invited'
  AND m.invited_by IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Só apaga a linha antiga se existe o convite pendente que a substitui.
DELETE FROM members m
 WHERE m.status = 'invited'
   AND m.invited_by IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM member_invites i
      WHERE i.workspace_id = m.workspace_id
        AND i.email = m.email
        AND i.accepted_at IS NULL
        AND i.revoked_at IS NULL
   );
--> statement-breakpoint

-- ─── 3b. Backfill do trial (15 dias) ────────────────────────────────────────────
-- now() é o início da transação: as duas tabelas recebem o mesmo instante.
UPDATE workspaces w
   SET trial_ends_at = coalesce(
         (SELECT s.trial_ends_at FROM subscriptions s
           WHERE s.workspace_id = w.id AND s.trial_ends_at IS NOT NULL),
         now() + interval '15 days'
       ),
       updated_at = now()
 WHERE w.subscription_status = 'trial'
   AND w.trial_ends_at IS NULL;
--> statement-breakpoint
UPDATE subscriptions s
   SET trial_ends_at = coalesce(
         (SELECT w.trial_ends_at FROM workspaces w WHERE w.id = s.workspace_id),
         now() + interval '15 days'
       ),
       updated_at = now()
 WHERE s.status = 'trial'
   AND s.trial_ends_at IS NULL;
--> statement-breakpoint

SET LOCAL lock_timeout TO DEFAULT;
