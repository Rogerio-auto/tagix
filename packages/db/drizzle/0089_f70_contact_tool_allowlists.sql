-- F70-S23 (segunda auditoria pré-deploy) — tools de contato com allowlist de escrita e a
-- marca humana que sobrevive à retomada automática.
--
-- 1) Marca humana x retomada automática (nota do M2).
--    A 0088 grava `ai_auto_enabled_at` em TODA transição não-`on` → `on` sem marca humana
--    nova. Efeito colateral: uma conversa sem origem elegível que um humano ligou, e que a
--    IA pausou porque o atendente respondeu (`paused` + `human_takeover`), perdia a marca
--    quando o reengajamento a retomava. A retomada não é um "ligar": devolve a IA ao
--    estado que um humano autorizou.
--
--    Regra (fail-closed), numa função só, usada pelo trigger E pelo UPDATE do
--    reengajamento (`apps/workers/src/agents/reengagement.ts`):
--      a retomada preserva a marca humana se, no estado ANTERIOR ao UPDATE,
--        - `ai_mode = 'paused'` e `ai_paused_reason = 'human_takeover'` (a pausa é a do
--          atendente respondendo — só nasce de `on`, `planHumanReply` em `@hm/shared`);
--        - `ai_enabled_at` existe e é <= `ai_paused_at` (a marca é de ANTES da pausa);
--        - a marca era válida: `ai_auto_enabled_at` NULL ou anterior a `ai_enabled_at`.
--      Qualquer outro `on` automático continua invalidando a marca (de `off`, de pausa
--      `manual`, de pausa sem instante, de marca já vencida). NULL em qualquer campo = não
--      preserva.
--
-- 2) Catálogo: descrições de `add_contact_tag`/`update_contact` falam da allowlist do
--    operador (`allowed_tags`/`custom_fields_write_keys`, negação por padrão) e
--    `display_name` vai a 80 caracteres. Gerado de `packages/db/src/seed/tools_agent.ts`
--    (`AGENT_TOOL_MIGRATIONS`); `tools_agent.test.ts` trava a divergência.
--
-- Sem DDL de tabela: só funções (CREATE OR REPLACE) e UPDATE de 2 linhas globais de `tools`.
--
-- Reverter:
--   reaplicar a função `public.conversations_ai_enable_mark()` da 0088;
--   DROP FUNCTION IF EXISTS public.conversation_ai_resume_keeps_human_mark(text, text,
--     timestamptz, timestamptz, timestamptz);
--   o catálogo volta com o UPDATE da 0087 para as duas keys.

CREATE OR REPLACE FUNCTION public.conversation_ai_resume_keeps_human_mark(
  p_ai_mode text,
  p_paused_reason text,
  p_paused_at timestamptz,
  p_enabled_at timestamptz,
  p_auto_enabled_at timestamptz
) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT coalesce(
    p_ai_mode = 'paused'
      AND p_paused_reason = 'human_takeover'
      AND p_paused_at IS NOT NULL
      AND p_enabled_at IS NOT NULL
      AND p_enabled_at <= p_paused_at
      AND (p_auto_enabled_at IS NULL OR p_enabled_at > p_auto_enabled_at),
    false
  )
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.conversations_ai_enable_mark() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.ai_mode = 'on'
     AND OLD.ai_mode IS DISTINCT FROM 'on'
     AND NEW.ai_enabled_at IS NOT DISTINCT FROM OLD.ai_enabled_at
     AND NOT public.conversation_ai_resume_keeps_human_mark(
       OLD.ai_mode, OLD.ai_paused_reason, OLD.ai_paused_at, OLD.ai_enabled_at,
       OLD.ai_auto_enabled_at
     ) THEN
    NEW.ai_auto_enabled_at := clock_timestamp();
  END IF;
  RETURN NEW;
END
$fn$;
--> statement-breakpoint
UPDATE "tools" SET "name" = 'Etiquetar contato', "description" = 'Aplica ao contato desta conversa uma etiqueta que o operador liberou para você (ex.: ''atendimento-humano'' quando uma pessoa da equipe precisa assumir). Não cria etiquetas: etiqueta inexistente ou não liberada é recusada.', "schema" = '{"type":"function","function":{"name":"add_contact_tag","description":"Aplica uma etiqueta liberada ao contato da conversa.","parameters":{"type":"object","required":["tag"],"properties":{"tag":{"type":"string","minLength":1,"maxLength":80,"description":"Nome exato de uma etiqueta liberada para você (ex.: ''atendimento-humano'')."}},"additionalProperties":false}}}'::jsonb, "handler_config" = '{}'::jsonb, "updated_at" = now()
WHERE "key" = 'add_contact_tag' AND "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "tools" SET "name" = 'Atualizar contato', "description" = 'Atualiza dados do contato desta conversa: nome de exibição, idioma, fuso horário e os campos personalizados liberados para você. Telefone, e-mail e consentimento NÃO podem ser alterados por aqui.', "schema" = '{"type":"function","function":{"name":"update_contact","description":"Atualiza campos permitidos do contato da conversa.","parameters":{"type":"object","properties":{"display_name":{"type":["string","null"],"minLength":1,"maxLength":80,"description":"Nome pelo qual o contato quer ser chamado: uma linha, sem colchetes, até 80 caracteres."},"language":{"type":["string","null"],"pattern":"^[a-z]{2,3}(-([A-Z]{2}|[0-9]{3}))?$","description":"Idioma preferido (BCP 47, ex.: ''pt-BR'')."},"timezone":{"type":["string","null"],"minLength":1,"maxLength":64,"description":"Fuso IANA (ex.: ''America/Sao_Paulo'')."},"custom_fields":{"type":["object","null"],"maxProperties":20,"propertyNames":{"pattern":"^[a-z][a-z0-9_]{0,63}$"},"additionalProperties":{"type":["string","number","boolean","null"]},"description":"Campos personalizados (merge: só as chaves informadas mudam). Só chaves liberadas para você; as demais são recusadas."}},"additionalProperties":false}}}'::jsonb, "handler_config" = '{}'::jsonb, "updated_at" = now()
WHERE "key" = 'update_contact' AND "workspace_id" IS NULL;
