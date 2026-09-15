-- F69-S01 — pedidos da Meta sobre dados de usuário: exclusão e desautorização.
--
-- Tabela de PLATAFORMA, sem workspace_id e sem RLS de tenant (como webhook_events):
-- o pedido chega identificado só pelo ID de usuário com escopo do app, e essa pessoa
-- pode ter conectado a Meta em vários workspaces ou em nenhum.
--
-- Guarda o mínimo para cumprir e provar o cumprimento. NÃO guarda o que foi
-- apagado: um registro de exclusão que guarda o conteúdo excluído não excluiu nada.

CREATE TABLE IF NOT EXISTS meta_data_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  meta_user_id text NOT NULL,
  confirmation_code text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  items_removed integer NOT NULL DEFAULT 0,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_data_requests_code
  ON meta_data_requests (confirmation_code);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_meta_data_requests_user
  ON meta_data_requests (kind, meta_user_id, requested_at DESC);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_data_requests_kind_chk') THEN
    ALTER TABLE meta_data_requests
      ADD CONSTRAINT meta_data_requests_kind_chk CHECK (kind IN ('deletion','deauthorize'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_data_requests_status_chk') THEN
    ALTER TABLE meta_data_requests
      ADD CONSTRAINT meta_data_requests_status_chk
      CHECK (status IN ('received','completed','no_data','failed'));
  END IF;
END $$;
--> statement-breakpoint

-- O papel da aplicação só existe onde o provisionamento de papéis rodou.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hm_app') THEN
    GRANT SELECT, INSERT, UPDATE ON meta_data_requests TO hm_app;
  END IF;
END $$;
