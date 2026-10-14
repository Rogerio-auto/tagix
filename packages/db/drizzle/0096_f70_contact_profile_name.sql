-- F70-S36 — nome do perfil do canal (pushname) guardado a parte do nome do sistema.
--
-- `contacts.display_name` e decisao de quem atende; o nome que a pessoa usa no WhatsApp/Instagram
-- e palpite do dono do aparelho e muda. Campo proprio, sempre atualizado pelo inbound, sem nunca
-- sobrescrever o display_name. A interface aplica: nome no sistema -> nome do perfil -> telefone.
--
-- Backfill (best-effort, so onde ha fonte confiavel): o parser do WAHA grava `notifyName` em
-- `messages.metadata->>'contactName'` das mensagens inbound. Meta WhatsApp NAO persiste o nome
-- (vem em value.contacts[], fora da mensagem) e o Instagram nao o expoe: sem fonte, nada e
-- inventado e esses contatos ganham o valor na proxima mensagem.
-- Idempotente: so preenche profile_name IS NULL.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS profile_name text,
  ADD COLUMN IF NOT EXISTS profile_name_updated_at timestamptz;
--> statement-breakpoint
COMMENT ON COLUMN contacts.profile_name IS
  'F70-S36: nome de perfil do contato no canal (pushname). Atualizado pelo inbound a cada mudanca; nunca substitui display_name.';
--> statement-breakpoint
WITH latest AS (
  SELECT DISTINCT ON (c.id)
         c.id AS contact_id,
         btrim(m.metadata->>'contactName') AS name,
         coalesce(m.provider_timestamp, m.created_at) AS seen_at
    FROM messages m
    JOIN conversations cv ON cv.id = m.conversation_id
    JOIN contacts c ON c.id = cv.contact_id
   WHERE m.direction = 'inbound'
     AND m.metadata ? 'contactName'
     AND jsonb_typeof(m.metadata->'contactName') = 'string'
     AND btrim(m.metadata->>'contactName') <> ''
     AND c.profile_name IS NULL
   ORDER BY c.id, coalesce(m.provider_timestamp, m.created_at) DESC
)
UPDATE contacts c
   SET profile_name = latest.name,
       profile_name_updated_at = latest.seen_at
  FROM latest
 WHERE c.id = latest.contact_id
   AND c.profile_name IS NULL;
