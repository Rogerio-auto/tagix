-- F69-S02 — conexão Meta por workspace.
--
-- Uma linha por pessoa que conectou a Meta num workspace: token de usuário de
-- longa duração (cifrado), permissões concedidas e negadas, ativos administrados.
-- `meta_user_id` é o identificador dos callbacks de exclusão e desautorização
-- (F69-S01) — sem ele gravado, aqueles callbacks não teriam o que encontrar.

CREATE TABLE IF NOT EXISTS meta_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  meta_user_id text NOT NULL,
  meta_user_name text,
  -- Nulo quando revogada: a conexão fica registrada, o token não.
  access_token_enc text,
  key_version integer NOT NULL DEFAULT 1,
  token_expires_at timestamptz,
  use_cases jsonb NOT NULL DEFAULT '[]'::jsonb,
  granted_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  declined_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  assets jsonb NOT NULL DEFAULT '{"pages":[],"adAccounts":[]}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  connected_by uuid REFERENCES members(id) ON DELETE SET NULL,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_connections_workspace_user
  ON meta_connections (workspace_id, meta_user_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_meta_connections_user
  ON meta_connections (meta_user_id);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_connections_status_chk') THEN
    ALTER TABLE meta_connections
      ADD CONSTRAINT meta_connections_status_chk CHECK (status IN ('active','revoked'));
  END IF;
  -- Conexão ativa sem token é estado impossível.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_connections_token_chk') THEN
    ALTER TABLE meta_connections
      ADD CONSTRAINT meta_connections_token_chk
      CHECK (status = 'revoked' OR access_token_enc IS NOT NULL);
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE meta_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE meta_connections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS meta_connections_isolation ON meta_connections;
--> statement-breakpoint
CREATE POLICY meta_connections_isolation ON meta_connections
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint

-- Os callbacks da Meta chegam sem workspace. Estas duas funções são as ÚNICAS
-- exceções à RLS desta tabela, no mesmo padrão da 0068: cada uma faz uma coisa,
-- recebe só o ID de usuário e devolve só uma contagem — nenhuma leitura de dado
-- entre tenants sai delas.

CREATE OR REPLACE FUNCTION public.meta_forget_user(p_meta_user_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.meta_connections WHERE meta_user_id = p_meta_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$function$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.meta_revoke_user(p_meta_user_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  n integer;
BEGIN
  UPDATE public.meta_connections
     SET status = 'revoked', access_token_enc = NULL, updated_at = pg_catalog.now()
   WHERE meta_user_id = p_meta_user_id
     AND status <> 'revoked';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.meta_forget_user(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.meta_revoke_user(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.meta_forget_user(text) TO hm_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.meta_revoke_user(text) TO hm_app;
