-- Custom SQL migration file, put your code below! --
-- RLS de products + deal_items (F47-S01 / COCKPIT_CLIENT_ENRICHMENT §3). Convenção
-- do repo: ambas têm workspace_id próprio -> isolamento direto por
-- current_setting('app.workspace_id', true)::uuid. O papel hm_app (sujeito a RLS)
-- recebe DML; o owner (migrate/seed) bypassa RLS. Espelha 0042.

GRANT SELECT, INSERT, UPDATE, DELETE ON products TO hm_app;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_isolation ON products
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON deal_items TO hm_app;
ALTER TABLE deal_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY deal_items_isolation ON deal_items
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
