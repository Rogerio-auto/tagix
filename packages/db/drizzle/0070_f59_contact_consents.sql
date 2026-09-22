-- F59-S03 — consentimento e supressão por canal (AGENCIA_PLAN.md §4.4).
--
-- `contacts.marketing_opt_in` é UM consentimento para TODOS os canais. A lei
-- americana é por canal e por finalidade: quem aceitou WhatsApp não consentiu SMS
-- de marketing. Esta migration cria o modelo granular e MIGRA o dado existente,
-- sem remover a coluna antiga (removê-la aqui quebraria leitores ainda não migrados).

CREATE TABLE IF NOT EXISTS contact_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL,
  source text NOT NULL,
  proof jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_by uuid REFERENCES members(id) ON DELETE SET NULL,
  market text NOT NULL DEFAULT 'BR',
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  CONSTRAINT contact_consents_purpose_chk CHECK (purpose IN ('transactional','marketing')),
  CONSTRAINT contact_consents_status_chk CHECK (status IN ('granted','revoked','never')),
  CONSTRAINT contact_consents_market_chk CHECK (market IN ('BR','US')),
  -- Linha `granted` sem carimbo de quando é prova incompleta.
  CONSTRAINT contact_consents_granted_at_chk
    CHECK (status <> 'granted' OR granted_at IS NOT NULL)
);
--> statement-breakpoint

-- É esta constraint que torna a migração de dado abaixo idempotente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_consents_scope
  ON contact_consents (workspace_id, contact_id, channel, purpose);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_contact_consents_lookup
  ON contact_consents (workspace_id, contact_id, channel);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS contact_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- NULO = supressão da empresa inteira, em todos os canais.
  channel text,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_contact_suppressions_lookup
  ON contact_suppressions (workspace_id, contact_id);
--> statement-breakpoint

-- Dois índices únicos parciais em vez de um UNIQUE com `channel`: no Postgres
-- NULL nunca é igual a NULL, então um UNIQUE comum deixaria duplicar a supressão
-- global — que é justamente a que precisa ser única.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_suppressions_global
  ON contact_suppressions (workspace_id, contact_id)
  WHERE channel IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_suppressions_channel
  ON contact_suppressions (workspace_id, contact_id, channel)
  WHERE channel IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_contact_suppressions_global
  ON contact_suppressions (workspace_id, contact_id)
  WHERE channel IS NULL;
--> statement-breakpoint

ALTER TABLE contact_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_consents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_consents_isolation ON contact_consents;
CREATE POLICY contact_consents_isolation ON contact_consents
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint

ALTER TABLE contact_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_suppressions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_suppressions_isolation ON contact_suppressions;
CREATE POLICY contact_suppressions_isolation ON contact_suppressions
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint

-- Migração do dado existente.
--
-- Todo opt-in de marketing vira consentimento de WhatsApp: é o canal em que o
-- consentimento foi de fato obtido (o produto só operou WhatsApp/Instagram até
-- aqui) e é o único que a prova sustenta. Assumir que valeria para SMS ou e-mail
-- seria inventar consentimento que ninguém deu.
--
-- ON CONFLICT DO NOTHING + índice único = idempotente: rodar duas vezes não duplica.
INSERT INTO contact_consents
  (workspace_id, contact_id, channel, purpose, status, source, proof, market, granted_at)
SELECT
  c.workspace_id,
  c.id,
  'meta_whatsapp',
  'marketing',
  'granted',
  COALESCE(c.opt_in_method, 'migration'),
  jsonb_strip_nulls(jsonb_build_object(
    'migratedFrom', 'contacts.marketing_opt_in',
    'optInMethod', c.opt_in_method,
    'optInSource', c.opt_in_source,
    'optInAt', c.opt_in_at
  )),
  COALESCE(w.market, 'BR'),
  COALESCE(c.opt_in_at, c.created_at)
FROM contacts c
JOIN workspaces w ON w.id = c.workspace_id
WHERE c.marketing_opt_in = true
  AND c.deleted_at IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Todo opt-out vira supressão da EMPRESA INTEIRA. Quem pediu para sair não pediu
-- para sair de um canal só, e o escopo mais restritivo é o seguro.
INSERT INTO contact_suppressions
  (workspace_id, contact_id, channel, reason, evidence, created_at)
SELECT
  c.workspace_id,
  c.id,
  NULL,
  'migration',
  jsonb_strip_nulls(jsonb_build_object(
    'migratedFrom', 'contacts.opt_out_at',
    'optOutReason', c.opt_out_reason
  )),
  c.opt_out_at
FROM contacts c
WHERE c.opt_out_at IS NOT NULL
  AND c.deleted_at IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

COMMENT ON COLUMN contacts.marketing_opt_in IS
  'DEPRECATED (F59-S03): consentimento agora vive em contact_consents, por canal e '
  'finalidade. Mantida para leitores ainda não migrados; remover quando não houver mais.';
