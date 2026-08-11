-- F58-S04 — descoberta mínima de canais para webhook de status de modelos.
--
-- O webhook chega com `waba_id`, antes de existir um contexto de workspace. Como
-- `channels` usa FORCE RLS, `getDb()` sob hm_app_login não pode (nem deve) enumerar
-- tenants diretamente. Esta função é a única exceção: devolve somente os dois IDs
-- necessários para abrir uma nova transação RLS por workspace.

CREATE OR REPLACE FUNCTION public.resolve_meta_template_channels(p_waba_id text)
RETURNS TABLE (workspace_id uuid, channel_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT c.workspace_id, c.id
  FROM public.channels AS c
  WHERE c.waba_id = p_waba_id
    AND c.provider = 'meta_whatsapp'
    AND c.is_active = true;
$function$;
--> statement-breakpoint

-- SECURITY DEFINER nunca fica executável implicitamente por PUBLIC. hm_app_login
-- herda hm_app, portanto recebe apenas o EXECUTE necessário, sem acesso à tabela.
REVOKE ALL ON FUNCTION public.resolve_meta_template_channels(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_meta_template_channels(text) TO hm_app;
