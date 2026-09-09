-- F61-S11 — mídia honesta: recuperar o recuperável, marcar o perdido.
--
-- Contexto: o histórico de mídia parou de renderizar em produção. Três causas,
-- e esta migration trata as duas que vivem no DADO (a terceira é a credencial
-- R2 revogada, que só o dono da conta resolve).
--
-- Tudo aqui é idempotente por construção: os WHERE excluem as linhas já tratadas,
-- então rodar duas vezes não muda nada.

-- ── 1. Deriva `mediaKey` da própria `media_url` ───────────────────────────────
--
-- 183 mensagens de junho/2026 têm signed URL mas não têm a key estável em
-- metadata, porque foram gravadas antes de `messages.ts` passar a persistir
-- `mediaKey`. Sem a key, `refresh-media-url` devolve 404 e a mídia é declarada
-- perdida sem estar — mas a key está no path da própria URL:
--
--   https://<bucket>.<acct>.r2.cloudflarestorage.com/<KEY>?X-Amz-...
--
-- Só derivamos quando a URL tem a forma esperada E a key resultante não é vazia:
-- gravar uma key errada é pior que não gravar (troca "sem chave" por "chave que
-- aponta para nada", e o erro passa a mentir sobre a causa).
update messages
set metadata = coalesce(metadata, '{}'::jsonb)
             || jsonb_build_object(
                  'mediaKey',
                  split_part(split_part(media_url, '?', 1), '.r2.cloudflarestorage.com/', 2)
                )
where media_url is not null
  and metadata->>'mediaKey' is null
  and media_url like '%.r2.cloudflarestorage.com/%'
  and length(split_part(split_part(media_url, '?', 1), '.r2.cloudflarestorage.com/', 2)) > 0;

-- ── 2. Marca a mídia que não volta ────────────────────────────────────────────
--
-- 561 mensagens nunca tiveram `media_url`: o worker não chegou a baixar, e o link
-- do provedor expira em ~30 dias. Delas, 324 são `coexistence_echo` — eco do
-- WhatsApp do próprio cliente, que não expõe download de mídia por design.
--
-- Sem esta marca, `deriveMediaState` mapeia `url === null` para `pending` e a UI
-- gira "carregando áudio…" para sempre. Carregando é uma promessa; girar sem fim
-- é pior que erro, porque não dá ao usuário nada para fazer. A marca deixa a UI
-- dizer a verdade.
update messages
set metadata = coalesce(metadata, '{}'::jsonb)
             || jsonb_build_object(
                  'mediaUnavailable', true,
                  'mediaUnavailableReason',
                  case
                    when metadata->>'origin' = 'coexistence_echo' then 'coexistence_echo'
                    else 'expired_at_source'
                  end
                )
where media_url is null
  and type in ('audio', 'voice', 'video', 'image', 'document', 'sticker')
  and (metadata->>'mediaUnavailable') is null;
