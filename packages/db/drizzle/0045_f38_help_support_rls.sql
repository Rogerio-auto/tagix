-- Custom SQL migration file, put your code below! --
-- RLS do dominio F38 (Help + Support).
--
-- help_categories / help_articles: PLATFORM-LEVEL (sem workspace_id), mesma
-- postura de platform_secrets -> SEM RLS de tenant. O hm_app ja recebe DML
-- (grant default da 0001); a escrita e gated por requirePlatformAdmin na API e a
-- leitura por status='published' no leitor. Nada a fazer aqui para essas duas.
--
-- help_article_feedback / support_threads: workspace-scoped -> isolamento direto
-- por current_setting('app.workspace_id'). support_messages NAO tem workspace_id
-- proprio -> isolada via subquery na thread (espelha flow_versions / event_participants).

GRANT SELECT, INSERT, UPDATE, DELETE ON help_article_feedback TO hm_app;
ALTER TABLE help_article_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY help_article_feedback_isolation ON help_article_feedback
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON support_threads TO hm_app;
ALTER TABLE support_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_threads_isolation ON support_threads
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON support_messages TO hm_app;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_messages_isolation ON support_messages
  USING (
    thread_id IN (
      SELECT id FROM support_threads
      WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  )
  WITH CHECK (
    thread_id IN (
      SELECT id FROM support_threads
      WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  );
