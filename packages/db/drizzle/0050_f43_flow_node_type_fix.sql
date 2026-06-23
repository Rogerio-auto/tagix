-- F43 fix: corrige node types inválidos nos flows de Niche Blueprint já provisionados.
--
-- Os 7 blueprints foram escritos usando `type: 'send_message'` e `type: 'schedule_event'`,
-- mas a engine (@hm/flow-engine registry) só conhece `message` — não existe handler para
-- `send_message` nem `schedule_event`. Resultado: mesmo com a flow_version criada (migration
-- 0049), todo flow de nicho falhava em runtime no primeiro nó de mensagem com
-- "handler desconhecido para node.type=send_message". O fix de código já renomeia nos
-- blueprints (send_message -> message; schedule_event -> message com texto de confirmação);
-- esta migration reescreve os flows e versions JÁ existentes em produção.
--
-- Substituição precisa sobre a forma canônica do jsonb (`"type": "<x>"`, com espaço após o
-- dois-pontos). schedule_event vira um nó `message` simples (mantém `data.title`, que o
-- handler ignora -> envio no-op, mas o flow CONTINUA em vez de falhar). Idempotente: re-rodar
-- não encontra mais os tokens. published/updated não alteram a versão referenciada por
-- execuções em curso (mesmo snapshot, só o node.type corrigido).

UPDATE "flows"
SET "nodes" = replace(
      replace("nodes"::text, '"type": "send_message"', '"type": "message"'),
      '"type": "schedule_event"', '"type": "message"'
    )::jsonb,
    "updated_at" = now()
WHERE "nodes"::text LIKE '%"type": "send_message"%'
   OR "nodes"::text LIKE '%"type": "schedule_event"%';

UPDATE "flow_versions"
SET "nodes" = replace(
      replace("nodes"::text, '"type": "send_message"', '"type": "message"'),
      '"type": "schedule_event"', '"type": "message"'
    )::jsonb
WHERE "nodes"::text LIKE '%"type": "send_message"%'
   OR "nodes"::text LIKE '%"type": "schedule_event"%';
