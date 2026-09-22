-- F69-S13 — como cada página entrega lead: webhook (segundos) ou reconciliação (até 15 min).
--
-- O app não tem `pages_manage_metadata`, então `POST /{page}/subscribed_apps` falha e o webhook de
-- lead não chega para ninguém. Ler lead por formulário não depende dessa permissão, e a
-- reconciliação da F69-S03 já faz essa leitura — então a página passa a ser cadastrável em modo
-- degradado, com o motivo guardado, e promovida a `webhook` quando a permissão sair.
--
-- Linhas existentes viram 'webhook': hoje só existe fonte que foi criada DEPOIS de a assinatura dar
-- certo. O default preserva essa verdade.

ALTER TABLE lead_ad_sources ADD COLUMN IF NOT EXISTS delivery text NOT NULL DEFAULT 'webhook';
--> statement-breakpoint
ALTER TABLE lead_ad_sources ADD COLUMN IF NOT EXISTS subscribe_error text;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_ad_sources_delivery_chk') THEN
    ALTER TABLE lead_ad_sources
      ADD CONSTRAINT lead_ad_sources_delivery_chk CHECK (delivery IN ('webhook','reconciliation'));
  END IF;
END $$;
