-- F60-S01 — identidades do contato (CANAIS_PLAN.md §3.2).
--
-- `contacts` e unico por (workspace_id, phone): telefone como identidade. Verdade
-- em WhatsApp, falso em e-mail e webchat. Sem este indice reverso, o lead que
-- chegou por e-mail e depois mandou WhatsApp vira dois contatos e dois historicos.

CREATE TABLE IF NOT EXISTS contact_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  kind text NOT NULL,
  value text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_identities_kind_chk
    CHECK (kind IN ('phone','email','ig_user','fb_user','web_visitor')),
  CONSTRAINT contact_identities_value_chk CHECK (length(value) BETWEEN 1 AND 320)
);
--> statement-breakpoint

-- Impede dois contatos com o mesmo identificador no mesmo workspace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_identities_value
  ON contact_identities (workspace_id, kind, value);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_contact_identities_contact
  ON contact_identities (workspace_id, contact_id);
--> statement-breakpoint

ALTER TABLE contact_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_identities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_identities_isolation ON contact_identities;
CREATE POLICY contact_identities_isolation ON contact_identities
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint

-- Backfill do que ja existe. ON CONFLICT DO NOTHING + indice unico = idempotente.
-- Telefone: so digitos, como a aplicacao normaliza.
INSERT INTO contact_identities (workspace_id, contact_id, kind, value)
SELECT c.workspace_id, c.id, 'phone', regexp_replace(c.phone, '[^0-9]', '', 'g')
FROM contacts c
WHERE c.phone IS NOT NULL
  AND c.deleted_at IS NULL
  AND regexp_replace(c.phone, '[^0-9]', '', 'g') <> ''
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- E-mail: minusculo e sem espaco. `citext` ja compara sem caixa, mas aqui o valor
-- e text e a normalizacao precisa ser explicita.
INSERT INTO contact_identities (workspace_id, contact_id, kind, value)
SELECT c.workspace_id, c.id, 'email', lower(btrim(c.email::text))
FROM contacts c
WHERE c.email IS NOT NULL
  AND c.deleted_at IS NULL
  AND btrim(c.email::text) <> ''
ON CONFLICT DO NOTHING;
