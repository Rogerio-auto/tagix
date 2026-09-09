-- F60-S03 — e-mail como canal (CANAIS_PLAN.md §4).
--
-- Amplia `channels_provider_chk` para aceitar 'email' e adiciona as colunas do
-- remetente. `email_domain` e o dominio autenticado com SPF/DKIM/DMARC — e ele
-- que decide se a mensagem chega ou cai no spam, e por isso e coluna e nao
-- settings: precisa ser consultavel.

ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_provider_chk;
--> statement-breakpoint

ALTER TABLE channels
  ADD CONSTRAINT channels_provider_chk
  CHECK (provider IN ('meta_whatsapp','meta_instagram','waha','email'));
--> statement-breakpoint

ALTER TABLE channels ADD COLUMN IF NOT EXISTS email_from text;
--> statement-breakpoint
ALTER TABLE channels ADD COLUMN IF NOT EXISTS email_from_name text;
--> statement-breakpoint
ALTER TABLE channels ADD COLUMN IF NOT EXISTS email_domain text;
--> statement-breakpoint

-- Um endereco de remetente por workspace: dois canais com o mesmo `from` tornam
-- impossivel rotear a resposta de volta para a conversa certa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_channels_email_from
  ON channels (workspace_id, email_from)
  WHERE email_from IS NOT NULL;
--> statement-breakpoint

-- Canal de e-mail sem remetente nao envia nada: a coerencia vale no banco, como
-- ja vale para phone_number_id (WhatsApp) e ig_user_id (Instagram).
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_email_from_chk;
--> statement-breakpoint
ALTER TABLE channels
  ADD CONSTRAINT channels_email_from_chk
  CHECK (provider <> 'email' OR email_from IS NOT NULL);
