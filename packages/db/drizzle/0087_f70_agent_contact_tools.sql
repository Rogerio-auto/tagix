-- F70-S15: tools de contato do agente no catálogo global (add_contact_tag, update_contact).
--
-- Pedidas pela Arcada (etiqueta `atendimento-humano`, que pausa a cadência) e por
-- templates de nicho, mas sem executor até aqui. Agora têm handler no endpoint interno
-- da API (contact-handlers.ts: alvo = contato da conversa, etiqueta só existente,
-- update em allowlist estrita) e classe no runtime.
--
-- Só insere as que faltam (tool global = workspace_id NULL; o UNIQUE (workspace_id, key)
-- trata NULL como distinto, por isso WHERE NOT EXISTS em vez de ON CONFLICT). Não habilita
-- nada em agent_tools: cada agente continua sem tool até alguém ligá-la (ou o seed da
-- Arcada, que vincula as dele).
--
-- GERADO a partir de packages/db/src/seed/tools_agent.ts (renderAgentToolsInsertSql);
-- tools_agent.test.ts trava a divergência. Não edite à mão.

INSERT INTO "tools" ("workspace_id", "key", "name", "description", "category", "schema", "handler_config", "is_global", "is_active")
SELECT NULL, 'add_contact_tag', 'Etiquetar contato', 'Aplica uma etiqueta já existente ao contato desta conversa (ex.: ''atendimento-humano'' quando uma pessoa da equipe precisa assumir). Não cria etiquetas novas: se a etiqueta não existir, a ação é recusada.', 'workflow', '{"type":"function","function":{"name":"add_contact_tag","description":"Aplica uma etiqueta existente ao contato da conversa.","parameters":{"type":"object","required":["tag"],"properties":{"tag":{"type":"string","minLength":1,"maxLength":80,"description":"Nome exato de uma etiqueta que já existe no workspace."}},"additionalProperties":false}}}'::jsonb, '{}'::jsonb, true, true
WHERE NOT EXISTS (SELECT 1 FROM "tools" WHERE "key" = 'add_contact_tag' AND "workspace_id" IS NULL);
--> statement-breakpoint
INSERT INTO "tools" ("workspace_id", "key", "name", "description", "category", "schema", "handler_config", "is_global", "is_active")
SELECT NULL, 'update_contact', 'Atualizar contato', 'Atualiza dados do contato desta conversa: nome de exibição, idioma, fuso horário e campos personalizados. Telefone, e-mail e consentimento NÃO podem ser alterados por aqui.', 'workflow', '{"type":"function","function":{"name":"update_contact","description":"Atualiza campos permitidos do contato da conversa.","parameters":{"type":"object","properties":{"display_name":{"type":["string","null"],"minLength":1,"maxLength":200},"language":{"type":["string","null"],"pattern":"^[a-z]{2,3}(-([A-Z]{2}|[0-9]{3}))?$","description":"Idioma preferido (BCP 47, ex.: ''pt-BR'')."},"timezone":{"type":["string","null"],"minLength":1,"maxLength":64,"description":"Fuso IANA (ex.: ''America/Sao_Paulo'')."},"custom_fields":{"type":["object","null"],"maxProperties":20,"propertyNames":{"pattern":"^[a-z][a-z0-9_]{0,63}$"},"additionalProperties":{"type":["string","number","boolean","null"]},"description":"Campos personalizados (merge: só as chaves informadas mudam)."}},"additionalProperties":false}}}'::jsonb, '{}'::jsonb, true, true
WHERE NOT EXISTS (SELECT 1 FROM "tools" WHERE "key" = 'update_contact' AND "workspace_id" IS NULL);
