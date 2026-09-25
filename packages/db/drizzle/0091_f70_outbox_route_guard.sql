-- F70-S24 — a outbox confere envelope e destino contra o workspace; event_id único por workspace.
--
-- ─── Por que ────────────────────────────────────────────────────────────────────
-- A policy `outbox_tenant_insert` (0086) prende só a COLUNA `workspace_id` ao workspace da
-- transação. O consumidor não lê a coluna: lê `envelope.workspaceId`. E o destino era livre:
-- com exchange '' a routing_key é o nome de QUALQUER fila, e o `hm.events` tem o bind
-- `hm.q.<fila>.#` de cada fila de trabalho. Um produtor com bug (ou uma injeção no payload que
-- chegasse ao construtor) gravava, dentro do próprio tenant, um job que o consumidor executaria
-- em OUTRO workspace, ou numa fila que nunca devia receber job pela outbox (inbound, kb_ingest…).
--
-- CHECKs valem para TODO papel (hm_app, relay, superuser), diferente da RLS:
--   * outbox_envelope_workspace_chk: o workspace do envelope é o da coluna. Comparação de texto
--     do uuid canônico (minúsculas), não cast: um `workspaceId` que não é uuid vira violação de
--     CHECK (23514), não erro de sintaxe no meio da transação do produtor. Envelope sem
--     `workspaceId` também viola (IS NOT DISTINCT FROM não deixa NULL passar).
--   * outbox_kind_exchange_chk: `job` só pelo exchange padrão, `event` só por `hm.events`.
--   * outbox_job_queue_chk: job só nas filas de `OUTBOX_JOB_QUEUES`
--     (packages/shared/src/mq/outbox.ts — FONTE ÚNICA; o teste
--     apps/workers/src/outbox/constraints.test.ts lê este CHECK com pg_get_constraintdef e falha
--     se divergir da constante). Fila nova = migração que recria este CHECK.
--   * outbox_event_routing_chk: evento só com routing key `domain.*` (só o bind `domain.#` da fila
--     de webhooks casa; nenhum `hm.q.<fila>.#`).
-- O relay repete as mesmas checagens antes de publicar (`outboxRowViolation`); a linha que viola
-- vai para `dead`, com log.
--
-- ─── event_id por workspace ───────────────────────────────────────────────────────
-- `uq_outbox_event_id` era global: um tenant que conhecesse (ou adivinhasse) o event_id de outro
-- faria o evento dele virar DO NOTHING. Passa a `(workspace_id, event_id)`. Esse índice também
-- serve à FK de workspaces (prefixo), então `idx_outbox_workspace` sai.
--
-- O enqueue passa a `ON CONFLICT DO NOTHING` SEM alvo. Com alvo, o Postgres exige SELECT nas
-- colunas árbitro e aplica a policy de SELECT à linha nova; sem alvo, basta INSERT. Os únicos
-- índices únicos da tabela são a PK (identity GENERATED ALWAYS, nunca colide) e
-- uq_outbox_workspace_event — o teste de constraints trava esse conjunto. Com isso o hm_app perde
-- o SELECT(event_id) e a policy `outbox_tenant_select` sai: o hm_app só GRAVA na outbox.
--
-- ─── Locks e pré-voo ──────────────────────────────────────────────────────────────
-- O LOCK SHARE ROW EXCLUSIVE para as gravações antes do pré-voo (o resultado não envelhece até o
-- ADD CONSTRAINT); o ALTER sobe para ACCESS EXCLUSIVE e valida as linhas existentes numa passada;
-- o índice único é construído na mesma transação (o migrator não aceita CONCURRENTLY). A outbox é
-- limitada pela retenção (enviados 7 dias, mortos 7 dias), então o bloqueio dura o tempo de ler
-- a tabela duas ou três vezes. Produtores e relay esperam até o COMMIT; `lock_timeout` faz a
-- migração falhar rápido em vez de enfileirar o tráfego atrás dela.
-- O pré-voo aborta (RAISE EXCEPTION, contagem por regra) se QUALQUER linha existente violar.
-- Nunca apaga linha em silêncio: a limpeza é decisão humana (ver o slot F70-S24).
--
-- Reverter: ver "Como reverter a 0091" em tasks/slots/F70/F70-S24-outbox-confere-envelope-e-fila.md.

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
LOCK TABLE outbox IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

-- ─── Pré-voo ────────────────────────────────────────────────────────────────────
DO $preflight$
DECLARE
  can_see_all boolean;
  n_workspace bigint;
  n_kind_exchange bigint;
  n_job_queue bigint;
  n_event_routing bigint;
  total bigint;
BEGIN
  -- FORCE RLS: um papel que não enxerga todas as linhas contaria zero e o pré-voo passaria em
  -- falso (o ADD CONSTRAINT ainda recusaria, mas sem a contagem). Superuser, BYPASSRLS ou o
  -- papel do relay (policy `outbox_relay_all`).
  SELECT r.rolsuper OR r.rolbypassrls OR pg_has_role(current_user, 'hm_outbox_relay', 'USAGE')
    INTO can_see_all
    FROM pg_roles r WHERE r.rolname = current_user;
  IF NOT coalesce(can_see_all, false) THEN
    RAISE EXCEPTION 'F70-S24: o pré-voo precisa de superuser, BYPASSRLS ou hm_outbox_relay (current_user=%)', current_user;
  END IF;

  SELECT count(*) INTO n_workspace FROM outbox
   WHERE lower(envelope ->> 'workspaceId') IS DISTINCT FROM workspace_id::text;
  SELECT count(*) INTO n_kind_exchange FROM outbox
   WHERE (kind = 'job') <> (exchange = '');
  SELECT count(*) INTO n_job_queue FROM outbox
   WHERE exchange = ''
     AND routing_key NOT IN ('hm.q.outbound', 'hm.q.media', 'hm.q.flows', 'hm.q.flow.execution', 'hm.q.campaigns');
  SELECT count(*) INTO n_event_routing FROM outbox
   WHERE exchange = 'hm.events' AND NOT starts_with(routing_key, 'domain.');

  total := n_workspace + n_kind_exchange + n_job_queue + n_event_routing;
  IF total > 0 THEN
    RAISE EXCEPTION 'F70-S24: % violação(ões) em outbox; nada foi alterado', total
      USING DETAIL = format(
        'envelope_workspace=%s kind_exchange=%s job_queue=%s event_routing=%s',
        n_workspace, n_kind_exchange, n_job_queue, n_event_routing),
      HINT = 'Inspecione as linhas (consultas em tasks/slots/F70/F70-S24-outbox-confere-envelope-e-fila.md), decida o destino delas e rode a migração de novo.';
  END IF;
END $preflight$;
--> statement-breakpoint

-- ─── CHECKs (uma passada de validação para os quatro) ────────────────────────────
ALTER TABLE outbox
  DROP CONSTRAINT IF EXISTS outbox_envelope_workspace_chk,
  DROP CONSTRAINT IF EXISTS outbox_kind_exchange_chk,
  DROP CONSTRAINT IF EXISTS outbox_job_queue_chk,
  DROP CONSTRAINT IF EXISTS outbox_event_routing_chk,
  ADD CONSTRAINT outbox_envelope_workspace_chk
    CHECK (lower(envelope ->> 'workspaceId') IS NOT DISTINCT FROM workspace_id::text),
  ADD CONSTRAINT outbox_kind_exchange_chk
    CHECK ((kind = 'job') = (exchange = '')),
  ADD CONSTRAINT outbox_job_queue_chk
    CHECK (exchange <> '' OR routing_key IN ('hm.q.outbound', 'hm.q.media', 'hm.q.flows', 'hm.q.flow.execution', 'hm.q.campaigns')),
  ADD CONSTRAINT outbox_event_routing_chk
    CHECK (exchange <> 'hm.events' OR starts_with(routing_key, 'domain.'));
--> statement-breakpoint

COMMENT ON CONSTRAINT outbox_job_queue_chk ON outbox IS
  'Filas de OUTBOX_JOB_QUEUES (packages/shared/src/mq/outbox.ts). Fonte única: mude a constante e recrie este CHECK numa migração (F70-S24).';
--> statement-breakpoint

-- ─── event_id por workspace ─────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_workspace_event ON outbox (workspace_id, event_id);
--> statement-breakpoint
DROP INDEX IF EXISTS uq_outbox_event_id;
--> statement-breakpoint
-- Prefixo de uq_outbox_workspace_event: a FK para workspaces (cascade) usa o índice novo.
DROP INDEX IF EXISTS idx_outbox_workspace;
--> statement-breakpoint

-- ─── hm_app só grava ────────────────────────────────────────────────────────────
REVOKE SELECT (event_id) ON outbox FROM hm_app;
--> statement-breakpoint
DROP POLICY IF EXISTS outbox_tenant_select ON outbox;
