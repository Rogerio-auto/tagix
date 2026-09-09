-- F60-S07 — conteudo de campanha por canal (CANAIS_PLAN.md §12).
--
-- `campaign_steps` nasceu moldado ao WhatsApp: `template_name` obrigatorio,
-- `language_code`, `template_components`. Modelo aprovado e conceito que so
-- existe no WhatsApp oficial — em e-mail o equivalente e assunto + corpo, e em
-- SMS e um texto com limite de caracteres.
--
-- A saida NAO e "mais colunas para todo mundo": e um `kind` que diz qual forma o
-- passo tem, com CHECK garantindo que cada forma carrega o que precisa. Mesma
-- disciplina que `channels` ja usa para exigir `phone_number_id` so no WhatsApp.

ALTER TABLE campaign_steps
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'wa_template';
--> statement-breakpoint

ALTER TABLE campaign_steps ADD COLUMN IF NOT EXISTS email_subject text;
--> statement-breakpoint
ALTER TABLE campaign_steps ADD COLUMN IF NOT EXISTS email_body_text text;
--> statement-breakpoint
ALTER TABLE campaign_steps ADD COLUMN IF NOT EXISTS email_body_html text;
--> statement-breakpoint

-- `template_name` deixa de ser obrigatorio: passo de e-mail nao tem modelo.
-- O CHECK abaixo garante que quem e `wa_template` continua tendo.
ALTER TABLE campaign_steps ALTER COLUMN template_name DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE campaign_steps DROP CONSTRAINT IF EXISTS campaign_steps_kind_chk;
--> statement-breakpoint
ALTER TABLE campaign_steps
  ADD CONSTRAINT campaign_steps_kind_chk CHECK (kind IN ('wa_template','email','text'));
--> statement-breakpoint

-- Coerencia por forma. Sem isto, um passo de e-mail sem assunto so falha na hora
-- do envio, com a campanha ja rodando e o cliente esperando.
ALTER TABLE campaign_steps DROP CONSTRAINT IF EXISTS campaign_steps_shape_chk;
--> statement-breakpoint
ALTER TABLE campaign_steps
  ADD CONSTRAINT campaign_steps_shape_chk CHECK (
    (kind = 'wa_template' AND template_name IS NOT NULL)
    OR (kind = 'email' AND email_subject IS NOT NULL
        AND (email_body_text IS NOT NULL OR email_body_html IS NOT NULL))
    OR (kind = 'text' AND email_body_text IS NOT NULL)
  );
