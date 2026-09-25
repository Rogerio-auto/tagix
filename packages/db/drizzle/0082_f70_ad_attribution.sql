-- F70-S05 — atribuição de anúncio no contato e no deal.
--
-- O parser do WhatsApp não lia `messages[].referral` (Click-to-WhatsApp): o `ctwa_clid` e o
-- id do anúncio se perdiam junto com o payload cru, que dura 30 dias em `webhook_events`.
--
-- Mesmo conjunto de colunas nas duas tabelas, semânticas diferentes:
--   contacts — PRIMEIRO TOQUE: o writer só grava com `ad_referred_at IS NULL`.
--   deals    — o anúncio que originou aquela oportunidade (ctwa_clid vai para a Conversions API).
--
-- Aditiva: colunas nullable, sem default, sem reescrita de tabela. CHECKs via DO $$ (idempotente,
-- padrão da 0081). Índices parciais pequenos (só linhas com anúncio).
-- RLS: as duas tabelas já têm policy por workspace_id; coluna nova não precisa de policy.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_channel text;
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_source_type text;
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_source_id text;
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_source_url text;
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_headline text;
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_body text;
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_media_type text;
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_ctwa_clid text;
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_referred_at timestamptz;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_ad_channel_chk') THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_ad_channel_chk
      CHECK (ad_channel IS NULL OR ad_channel IN ('meta_whatsapp','meta_instagram'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_ad_attribution_chk') THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_ad_attribution_chk
      CHECK ((ad_channel IS NULL) = (ad_referred_at IS NULL) AND (ad_channel IS NULL) = (ad_source_type IS NULL));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contacts_ad_source
  ON contacts (workspace_id, ad_source_id)
  WHERE ad_source_id IS NOT NULL;
--> statement-breakpoint

ALTER TABLE deals ADD COLUMN IF NOT EXISTS ad_channel text;
--> statement-breakpoint
ALTER TABLE deals ADD COLUMN IF NOT EXISTS ad_source_type text;
--> statement-breakpoint
ALTER TABLE deals ADD COLUMN IF NOT EXISTS ad_source_id text;
--> statement-breakpoint
ALTER TABLE deals ADD COLUMN IF NOT EXISTS ad_source_url text;
--> statement-breakpoint
ALTER TABLE deals ADD COLUMN IF NOT EXISTS ad_headline text;
--> statement-breakpoint
ALTER TABLE deals ADD COLUMN IF NOT EXISTS ad_body text;
--> statement-breakpoint
ALTER TABLE deals ADD COLUMN IF NOT EXISTS ad_media_type text;
--> statement-breakpoint
ALTER TABLE deals ADD COLUMN IF NOT EXISTS ad_ctwa_clid text;
--> statement-breakpoint
ALTER TABLE deals ADD COLUMN IF NOT EXISTS ad_referred_at timestamptz;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_ad_channel_chk') THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_ad_channel_chk
      CHECK (ad_channel IS NULL OR ad_channel IN ('meta_whatsapp','meta_instagram'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_ad_attribution_chk') THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_ad_attribution_chk
      CHECK ((ad_channel IS NULL) = (ad_referred_at IS NULL) AND (ad_channel IS NULL) = (ad_source_type IS NULL));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_deals_ad_source
  ON deals (workspace_id, ad_source_id)
  WHERE ad_source_id IS NOT NULL;
