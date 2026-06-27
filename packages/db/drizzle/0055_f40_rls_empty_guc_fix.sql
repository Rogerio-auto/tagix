-- Custom SQL migration file, put your code below! --
-- F40-S01: o GUC customizado `app.workspace_id`, depois de setado via set_config(local)
-- numa conexao fisica, reverte ao fim da transacao para string vazia ('') — NAO para NULL.
-- As policies RLS castavam `(current_setting('app.workspace_id', true))::uuid`; numa conexao
-- reaproveitada do pool (pos-withWorkspace) esse cast vira `''::uuid` e estoura
-- `invalid input syntax for type uuid: ""` toda vez que uma query cross-tenant (schedulers
-- flow-wakeup / automations via getDb()) e avaliada sob RLS. Fix: centralizar a leitura do
-- GUC numa funcao que trata NULL (conexao fresca) e '' (conexao envenenada) como "sem
-- workspace" -> retorna NULL -> a policy nega tudo (0 rows) em vez de estourar. Isolamento
-- de tenant preservado (NULL nunca casa com workspace_id).

-- ─── Helper centralizado ─────────────────────────────────────────────────────
-- STABLE + SQL puro: o planner faz inline, performance identica ao current_setting cru.
CREATE OR REPLACE FUNCTION app_current_workspace() RETURNS uuid
  LANGUAGE sql STABLE
  AS $fn$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $fn$;
--> statement-breakpoint

-- hm_app sofre RLS e precisa executar o helper dentro das policies.
GRANT EXECUTE ON FUNCTION app_current_workspace() TO hm_app;
--> statement-breakpoint

-- ─── Reescreve TODAS as policies que castam o GUC para usar o helper ──────────
-- Idempotente: ao rodar de novo, nenhuma policy referencia mais o GUC cru -> o loop
-- nao faz nada. Falha ALTO (RAISE) se sobrar referencia crua -> guarda contra no-op
-- silencioso (ex.: variante de texto nao prevista numa policy futura).
DO $do$
DECLARE
  pol record;
  new_qual text;
  new_check text;
  clause text;
  leftover int;
BEGIN
  FOR pol IN
    SELECT n.nspname AS schemaname, c.relname AS tablename, p.polname AS policyname,
           pg_get_expr(p.polqual, p.polrelid) AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS withcheck
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (pg_get_expr(p.polqual, p.polrelid) LIKE '%current_setting(''app.workspace_id''%'
        OR pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%current_setting(''app.workspace_id''%')
  LOOP
    new_qual := replace(
      pol.qual,
      '(current_setting(''app.workspace_id''::text, true))::uuid',
      'app_current_workspace()'
    );
    new_check := replace(
      pol.withcheck,
      '(current_setting(''app.workspace_id''::text, true))::uuid',
      'app_current_workspace()'
    );

    clause := '';
    IF new_qual IS NOT NULL THEN
      clause := clause || ' USING (' || new_qual || ')';
    END IF;
    IF new_check IS NOT NULL THEN
      clause := clause || ' WITH CHECK (' || new_check || ')';
    END IF;

    EXECUTE format('ALTER POLICY %I ON %I.%I%s',
      pol.policyname, pol.schemaname, pol.tablename, clause);
  END LOOP;

  -- Guarda: nenhuma policy pode continuar castando o GUC cru.
  SELECT count(*) INTO leftover
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%current_setting(''app.workspace_id''%'
      OR coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%current_setting(''app.workspace_id''%');

  IF leftover > 0 THEN
    RAISE EXCEPTION 'F40-S01: % policy(ies) ainda referenciam o GUC cru apos a migracao', leftover;
  END IF;
END
$do$;
