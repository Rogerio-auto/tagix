-- Custom SQL migration file, put your code below! --
-- F56-S08 — RLS como backstop real (SEC-03/SEC-04/DB-08).
--
-- Origem: AUDITORIA_TECNICA.md §3.1/§3.8. Três buracos na malha multi-tenant:
--   1. NENHUMA tabela tinha `FORCE ROW LEVEL SECURITY` → o DONO das tabelas (e, em
--      prod, o papel de conexão que também é dono) bypassa a RLS mesmo com ENABLE.
--   2. `agent_templates`/`agent_template_questions` têm dado por-workspace mas a RLS
--      nunca foi habilitada (0015 só fez GRANT) → um tenant lia templates de outro.
--   3. O papel de conexão de prod é superuser+BYPASSRLS → RLS efetivamente OFF em
--      qualquer caminho `getDb()` que não faça `SET LOCAL ROLE hm_app`.
--
-- Esta migration entrega as 3 camadas de defense-in-depth. A troca operacional do
-- role de conexão em prod (DATABASE_URL → hm_app_login) é executada na janela de
-- deploy — ver "Papel de conexão não-privilegiado" abaixo.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) agent_templates / agent_template_questions — RLS com leitura global
-- ─────────────────────────────────────────────────────────────────────────────
-- `agent_templates.workspace_id IS NULL` = template GLOBAL da plataforma: legível
-- por TODOS os workspaces, porém read-only para o app (semeado pelo owner/bypass).
-- `workspace_id` setado = template do tenant: isolado como qualquer tabela tenant.
--
-- Política por comando (permissivas → OR):
--   * read  (FOR SELECT): global OU do próprio workspace.
--   * write (FOR ALL):    apenas o próprio workspace (USING + WITH CHECK) → um
--     tenant NÃO pode ler-para-escrever, atualizar nem DELETAR templates globais.
-- O GRANT já existe desde 0015; repetido aqui é idempotente e documenta a intenção.
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_templates TO hm_app;
ALTER TABLE agent_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_templates_read ON agent_templates;
CREATE POLICY agent_templates_read ON agent_templates
  FOR SELECT
  USING (workspace_id IS NULL OR workspace_id = app_current_workspace());
DROP POLICY IF EXISTS agent_templates_write ON agent_templates;
CREATE POLICY agent_templates_write ON agent_templates
  FOR ALL
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint

-- agent_template_questions não tem workspace_id próprio → isola via subquery no
-- template dono (espelha flow_versions / event_participants). Perguntas de template
-- global são legíveis por todos; perguntas de template de tenant são isoladas.
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_template_questions TO hm_app;
ALTER TABLE agent_template_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_template_questions_read ON agent_template_questions;
CREATE POLICY agent_template_questions_read ON agent_template_questions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agent_templates t
      WHERE t.id = agent_template_questions.template_id
        AND (t.workspace_id IS NULL OR t.workspace_id = app_current_workspace())
    )
  );
DROP POLICY IF EXISTS agent_template_questions_write ON agent_template_questions;
CREATE POLICY agent_template_questions_write ON agent_template_questions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM agent_templates t
      WHERE t.id = agent_template_questions.template_id
        AND t.workspace_id = app_current_workspace()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agent_templates t
      WHERE t.id = agent_template_questions.template_id
        AND t.workspace_id = app_current_workspace()
    )
  );
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) FORCE ROW LEVEL SECURITY em TODA tabela com RLS habilitada
-- ─────────────────────────────────────────────────────────────────────────────
-- ENABLE sozinho não vale para o DONO da tabela (nem, em prod, para um papel de
-- conexão que também seja dono). FORCE remove esse bypass do owner — a RLS passa a
-- valer para todos exceto superuser/BYPASSRLS. Aplicado dinamicamente a toda tabela
-- `relrowsecurity = true` (cobre RLS_TABLES + tabelas isoladas por subquery + as
-- duas de agent_templates acima). Idempotente: pula o que já está FORCE.
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = false
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END
$do$;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Papel de conexão não-privilegiado (hm_app_login)
-- ─────────────────────────────────────────────────────────────────────────────
-- `hm_app` é NOLOGIN por design (assumido via `SET LOCAL ROLE hm_app` dentro de
-- withWorkspace). Para FECHAR o bypass em caminhos `getDb()` diretos, a conexão
-- física de API/workers deve usar um papel de LOGIN **sem** superuser e **sem**
-- BYPASSRLS. Assim, mesmo uma query sem `SET ROLE` fica sujeita à RLS (default-deny
-- quando `app.workspace_id` não está setado) em vez de ver todos os tenants.
--
-- hm_app_login herda os privilégios de DML de hm_app (INHERIT default) e pode
-- assumir hm_app no withWorkspace. NÃO é dono das tabelas → o FORCE acima é o cinto
-- extra caso, em prod, o role de app venha a coincidir com o owner.
--
-- Operacional (deploy): definir a senha fora do versionamento —
--   ALTER ROLE hm_app_login LOGIN PASSWORD :'senha_do_secret';
-- e apontar DATABASE_URL de API/workers para hm_app_login. Migrations, seeds e
-- schedulers cross-tenant continuam com o papel owner/superuser (bypass legítimo).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hm_app_login') THEN
    -- Sem LOGIN até o deploy definir a senha; NOSUPERUSER/NOBYPASSRLS são o ponto.
    CREATE ROLE hm_app_login NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
GRANT hm_app TO hm_app_login;
