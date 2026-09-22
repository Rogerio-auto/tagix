-- F69-S03 — leads de anúncios da Meta.
--
-- lead_ad_sources: páginas de onde o workspace recebe leads.
-- lead_ad_submissions: cada lead recebido e o que ele virou.
--
-- O webhook de lead chega só com a página — sem workspace. Duas funções
-- SECURITY DEFINER mínimas (padrão da 0068) são as ÚNICAS exceções à RLS:
-- uma resolve página → workspaces para o webhook, outra lista as fontes ativas
-- para a reconciliação. Nenhuma devolve dado de lead.

CREATE TABLE IF NOT EXISTS lead_ad_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES meta_connections(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  page_name text,
  status text NOT NULL DEFAULT 'active',
  subscribed_at timestamptz,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_ad_sources_workspace_page
  ON lead_ad_sources (workspace_id, page_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_lead_ad_sources_page ON lead_ad_sources (page_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS lead_ad_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_id uuid REFERENCES lead_ad_sources(id) ON DELETE SET NULL,
  leadgen_id text NOT NULL,
  page_id text NOT NULL,
  form_id text,
  ad_id text,
  lead_created_at timestamptz,
  answers jsonb,
  consent_responses jsonb,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'received',
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
--> statement-breakpoint

-- Webhook repetido, reconciliação e retry caem no mesmo lead: um registro só.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_ad_submissions_workspace_leadgen
  ON lead_ad_submissions (workspace_id, leadgen_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_lead_ad_submissions_status
  ON lead_ad_submissions (workspace_id, status, created_at DESC);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_ad_sources_status_chk') THEN
    ALTER TABLE lead_ad_sources
      ADD CONSTRAINT lead_ad_sources_status_chk CHECK (status IN ('active','inactive'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_ad_submissions_status_chk') THEN
    ALTER TABLE lead_ad_submissions
      ADD CONSTRAINT lead_ad_submissions_status_chk
      CHECK (status IN ('received','processed','failed'));
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE lead_ad_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE lead_ad_sources FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS lead_ad_sources_isolation ON lead_ad_sources;
--> statement-breakpoint
CREATE POLICY lead_ad_sources_isolation ON lead_ad_sources
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint

ALTER TABLE lead_ad_submissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE lead_ad_submissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS lead_ad_submissions_isolation ON lead_ad_submissions;
--> statement-breakpoint
CREATE POLICY lead_ad_submissions_isolation ON lead_ad_submissions
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint

-- Webhook: página → fontes ativas. Só IDs; o resto abre transação RLS por workspace.
CREATE OR REPLACE FUNCTION public.resolve_lead_ad_sources(p_page_id text)
RETURNS TABLE (workspace_id uuid, source_id uuid, connection_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT s.workspace_id, s.id, s.connection_id
  FROM public.lead_ad_sources AS s
  WHERE s.page_id = p_page_id
    AND s.status = 'active';
$function$;
--> statement-breakpoint

-- Reconciliação: fontes ativas de todos os workspaces. Só IDs e o carimbo de até
-- onde já foi conferido.
CREATE OR REPLACE FUNCTION public.list_active_lead_ad_sources()
RETURNS TABLE (
  workspace_id uuid,
  source_id uuid,
  connection_id uuid,
  page_id text,
  last_reconciled_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT s.workspace_id, s.id, s.connection_id, s.page_id, s.last_reconciled_at
  FROM public.lead_ad_sources AS s
  WHERE s.status = 'active';
$function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.resolve_lead_ad_sources(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.list_active_lead_ad_sources() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.resolve_lead_ad_sources(text) TO hm_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.list_active_lead_ad_sources() TO hm_app;
