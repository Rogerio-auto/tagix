-- F70-S10: catálogo global das tools de agente que já têm executor.
--
-- Até aqui só as tools de calendar existiam em "tools" (seed F7-S04); workflow
-- (transfer_to_human, transfer_to_agent, escalate, mark_resolved,
-- change_conversation_status, register_conversion, move_deal_stage), knowledge
-- (search_knowledge_base) e database (query_contact, query_deal, query_conversation)
-- não existiam, então nenhum agente conseguia habilitá-las.
--
-- Só insere as que faltam (tool global = workspace_id NULL; o UNIQUE (workspace_id, key)
-- trata NULL como distinto, por isso WHERE NOT EXISTS em vez de ON CONFLICT). Não habilita
-- nada em agent_tools: cada agente continua sem tool até alguém ligá-la.
--
-- GERADO a partir de packages/db/src/seed/tools_agent.ts (renderAgentToolsInsertSql);
-- tools_agent.test.ts trava a divergência. Não edite à mão.

INSERT INTO "tools" ("workspace_id", "key", "name", "description", "category", "schema", "handler_config", "is_global", "is_active")
SELECT NULL, 'transfer_to_human', 'Transferir para humano', 'Tira o agente de IA da conversa e a entrega a um atendente humano. Use quando o cliente pede explicitamente falar com uma pessoa, ou quando o pedido está fora da sua capacidade. Após transferir, não responda mais.', 'workflow', '{"type":"function","function":{"name":"transfer_to_human","description":"Entrega a conversa a um atendente humano.","parameters":{"type":"object","required":["reason"],"properties":{"reason":{"type":"string","minLength":1,"maxLength":500,"description":"Motivo da transferência, em uma frase (registrado para o atendente)."},"department_id":{"type":["string","null"],"description":"ID do departamento de destino. Omitir deixa o roteamento ao sistema."}},"additionalProperties":false}}}'::jsonb, '{}'::jsonb, true, true
WHERE NOT EXISTS (SELECT 1 FROM "tools" WHERE "key" = 'transfer_to_human' AND "workspace_id" IS NULL);
--> statement-breakpoint
INSERT INTO "tools" ("workspace_id", "key", "name", "description", "category", "schema", "handler_config", "is_global", "is_active")
SELECT NULL, 'transfer_to_agent', 'Transferir para outro agente de IA', 'Passa a conversa para OUTRO agente de IA especializado (um dos pares do seu departamento listados no prompt). Após transferir, NÃO responda mais — o outro agente assume a partir daqui.', 'workflow', '{"type":"function","function":{"name":"transfer_to_agent","description":"Transfere a conversa para outro agente de IA.","parameters":{"type":"object","required":["targetAgentId"],"properties":{"targetAgentId":{"type":"string","description":"ID (UUID) do agente de destino — um dos pares listados no prompt."},"reason":{"type":["string","null"],"minLength":1,"maxLength":500}},"additionalProperties":false}}}'::jsonb, '{}'::jsonb, true, true
WHERE NOT EXISTS (SELECT 1 FROM "tools" WHERE "key" = 'transfer_to_agent' AND "workspace_id" IS NULL);
--> statement-breakpoint
INSERT INTO "tools" ("workspace_id", "key", "name", "description", "category", "schema", "handler_config", "is_global", "is_active")
SELECT NULL, 'escalate', 'Escalar para supervisor', 'Notifica um supervisor humano sobre a conversa, sem sair do atendimento. Use para casos sensíveis (reclamação grave, risco de churn, decisão acima da sua alçada). Continue atendendo normalmente após escalar.', 'workflow', '{"type":"function","function":{"name":"escalate","description":"Sinaliza a conversa para um supervisor.","parameters":{"type":"object","required":["reason"],"properties":{"reason":{"type":"string","minLength":1,"maxLength":500},"severity":{"type":"string","enum":["low","medium","high"],"default":"medium"}},"additionalProperties":false}}}'::jsonb, '{}'::jsonb, true, true
WHERE NOT EXISTS (SELECT 1 FROM "tools" WHERE "key" = 'escalate' AND "workspace_id" IS NULL);
--> statement-breakpoint
INSERT INTO "tools" ("workspace_id", "key", "name", "description", "category", "schema", "handler_config", "is_global", "is_active")
SELECT NULL, 'mark_resolved', 'Marcar como resolvida', 'Fecha a conversa marcando-a como resolvida. Use somente quando o pedido do cliente foi de fato atendido e não há mais nada pendente.', 'workflow', '{"type":"function","function":{"name":"mark_resolved","description":"Marca a conversa como resolvida.","parameters":{"type":"object","required":["resolution"],"properties":{"resolution":{"type":"string","minLength":1,"maxLength":1000}},"additionalProperties":false}}}'::jsonb, '{}'::jsonb, true, true
WHERE NOT EXISTS (SELECT 1 FROM "tools" WHERE "key" = 'mark_resolved' AND "workspace_id" IS NULL);
--> statement-breakpoint
INSERT INTO "tools" ("workspace_id", "key", "name", "description", "category", "schema", "handler_config", "is_global", "is_active")
SELECT NULL, 'change_conversation_status', 'Alterar status da conversa', 'Altera o status da conversa (ex.: ''pending'' enquanto se aguarda o cliente). Para fechar como resolvida, prefira a ferramenta de marcar como resolvida. O sistema valida a transição.', 'workflow', '{"type":"function","function":{"name":"change_conversation_status","description":"Altera o status da conversa.","parameters":{"type":"object","required":["target_status"],"properties":{"target_status":{"type":"string","enum":["open","pending","resolved","closed"]},"note":{"type":["string","null"],"maxLength":500}},"additionalProperties":false}}}'::jsonb, '{}'::jsonb, true, true
WHERE NOT EXISTS (SELECT 1 FROM "tools" WHERE "key" = 'change_conversation_status' AND "workspace_id" IS NULL);
--> statement-breakpoint
INSERT INTO "tools" ("workspace_id", "key", "name", "description", "category", "schema", "handler_config", "is_global", "is_active")
SELECT NULL, 'register_conversion', 'Registrar conversão', 'Registra uma conversão atribuída a este atendimento (venda, agendamento, lead qualificado etc.). Use somente quando a conversão de fato ocorreu. Para valor monetário, informe ''value_cents'' e ''currency''.', 'workflow', '{"type":"function","function":{"name":"register_conversion","description":"Registra uma conversão da conversa.","parameters":{"type":"object","required":["type_key"],"properties":{"type_key":{"type":"string","minLength":1,"maxLength":120},"value_cents":{"type":["integer","null"],"minimum":0},"currency":{"type":["string","null"],"minLength":3,"maxLength":3},"note":{"type":["string","null"],"maxLength":500}},"additionalProperties":false}}}'::jsonb, '{}'::jsonb, true, true
WHERE NOT EXISTS (SELECT 1 FROM "tools" WHERE "key" = 'register_conversion' AND "workspace_id" IS NULL);
--> statement-breakpoint
INSERT INTO "tools" ("workspace_id", "key", "name", "description", "category", "schema", "handler_config", "is_global", "is_active")
SELECT NULL, 'move_deal_stage', 'Mover negócio de estágio', 'Move o negócio (deal) do contato para outro estágio do funil. Use quando a conversa indica progresso. A validação de transição e o histórico são aplicados no servidor.', 'workflow', '{"type":"function","function":{"name":"move_deal_stage","description":"Move o deal para outro estágio do pipeline.","parameters":{"type":"object","required":["stage_id"],"properties":{"stage_id":{"type":"string","minLength":1},"deal_id":{"type":["string","null"]}},"additionalProperties":false}}}'::jsonb, '{}'::jsonb, true, true
WHERE NOT EXISTS (SELECT 1 FROM "tools" WHERE "key" = 'move_deal_stage' AND "workspace_id" IS NULL);
--> statement-breakpoint
INSERT INTO "tools" ("workspace_id", "key", "name", "description", "category", "schema", "handler_config", "is_global", "is_active")
SELECT NULL, 'search_knowledge_base', 'Buscar na base de conhecimento', 'Busca trechos relevantes na base de conhecimento do workspace (RAG). Use antes de responder sobre produtos/políticas.', 'knowledge', '{"type":"function","function":{"name":"search_knowledge_base","description":"Busca trechos na base de conhecimento.","parameters":{"type":"object","required":["query"],"properties":{"query":{"type":"string","description":"Pergunta/consulta em linguagem natural."},"k":{"type":"integer","minimum":1,"maximum":20,"default":5}},"additionalProperties":false}}}'::jsonb, '{}'::jsonb, true, true
WHERE NOT EXISTS (SELECT 1 FROM "tools" WHERE "key" = 'search_knowledge_base' AND "workspace_id" IS NULL);
--> statement-breakpoint
INSERT INTO "tools" ("workspace_id", "key", "name", "description", "category", "schema", "handler_config", "is_global", "is_active")
SELECT NULL, 'query_contact', 'Consultar contato', 'Lê dados do contato atual da conversa (nome, e-mail, telefone, etc.).', 'database', '{"type":"function","function":{"name":"query_contact","description":"Lê dados do contato atual.","parameters":{"type":"object","properties":{"fields":{"type":"array","items":{"type":"string"},"default":["display_name","email","phone","language","source","custom_fields"]}},"additionalProperties":false}}}'::jsonb, '{"table":"contacts","allowed_columns":{"read":["display_name","email","phone","language","source","custom_fields"],"write":[]},"restricted_columns":["notes"],"required_columns":[]}'::jsonb, true, true
WHERE NOT EXISTS (SELECT 1 FROM "tools" WHERE "key" = 'query_contact' AND "workspace_id" IS NULL);
--> statement-breakpoint
INSERT INTO "tools" ("workspace_id", "key", "name", "description", "category", "schema", "handler_config", "is_global", "is_active")
SELECT NULL, 'query_deal', 'Consultar negócio (deal)', 'Lê o negócio (deal) aberto do contato atual: estágio, valor, pipeline e campos personalizados.', 'database', '{"type":"function","function":{"name":"query_deal","description":"Lê o deal aberto do contato atual.","parameters":{"type":"object","properties":{"fields":{"type":"array","items":{"type":"string"},"default":["id","title","stage_id","pipeline_id","value_cents","currency","source","custom_fields"]}},"additionalProperties":false}}}'::jsonb, '{"table":"deals","allowed_columns":{"read":["id","title","stage_id","pipeline_id","value_cents","currency","source","custom_fields"],"write":[]},"restricted_columns":["notes"],"required_columns":[]}'::jsonb, true, true
WHERE NOT EXISTS (SELECT 1 FROM "tools" WHERE "key" = 'query_deal' AND "workspace_id" IS NULL);
--> statement-breakpoint
INSERT INTO "tools" ("workspace_id", "key", "name", "description", "category", "schema", "handler_config", "is_global", "is_active")
SELECT NULL, 'query_conversation', 'Consultar conversa', 'Lê o estado da conversa atual (status, modo IA, atribuição, departamento).', 'database', '{"type":"function","function":{"name":"query_conversation","description":"Lê o estado da conversa atual.","parameters":{"type":"object","properties":{},"additionalProperties":false}}}'::jsonb, '{"table":"conversations","allowed_columns":{"read":["status","ai_mode","assigned_to","department_id","kind"],"write":[]},"restricted_columns":[],"required_columns":[]}'::jsonb, true, true
WHERE NOT EXISTS (SELECT 1 FROM "tools" WHERE "key" = 'query_conversation' AND "workspace_id" IS NULL);
