-- F70-S16 — Outbox transacional (eventos de domínio e jobs) + dedup indexado do fan-out de webhooks.
--
-- ─── Por que ────────────────────────────────────────────────────────────────────
-- Os produtores publicavam no RabbitMQ DEPOIS do commit. Se o processo caísse entre os dois, o
-- evento sumia (o webhook do cliente nunca disparava) e a delivery de campanha ficava `queued` sem
-- job. Agora o produtor grava a mensagem nesta tabela NA MESMA transação do dado; um relay nos
-- workers lê com FOR UPDATE SKIP LOCKED, publica com publisher confirms e só então marca `sent`.
-- Rollback não deixa linha, então nada sai de uma transação que não aconteceu.
--
-- ─── Acesso (decisão de segurança) ────────────────────────────────────────────────
-- A outbox é infraestrutura do sistema: linhas de TODOS os workspaces, com payload que pode ter
-- texto de mensagem. Nenhum tenant lê nada daqui.
--   * hm_app (papel da API e dos `withWorkspace` dos workers): INSERT, mais SELECT só da coluna
--     `event_id`. Sem UPDATE nem DELETE. O INSERT passa pela policy `outbox_tenant_insert`: só
--     grava linha do workspace da transação (`app_current_workspace()`), então um handler com bug
--     não enfileira evento para outro tenant. O SELECT(event_id) existe porque o
--     `ON CONFLICT (event_id) DO NOTHING` exige SELECT na coluna árbitro e, com RLS, aplica a
--     policy de SELECT à linha nova; `outbox_tenant_select` limita isso ao próprio workspace. Na
--     prática o hm_app enxerga, no máximo, os event_ids do próprio tenant — nunca payload, destino
--     ou estado, e nada de outro workspace. O enqueue não usa RETURNING.
--   * hm_outbox_relay (NOLOGIN): tudo o que o relay precisa (ler, marcar, limpar). É concedido ao
--     papel que roda esta migração — o mesmo papel de conexão dos workers hoje (PG_USER). Se os
--     workers passarem a um papel de login próprio, conceda `hm_outbox_relay` a ele. NUNCA ao papel
--     de login da API: a API só grava (via hm_app).
--   * PUBLIC: nada.
-- O `ALTER DEFAULT PRIVILEGES` da 0001 daria SELECT/INSERT/UPDATE/DELETE ao hm_app em toda tabela
-- nova; o REVOKE abaixo desfaz isso aqui, explicitamente.
--
-- ─── Dedup do fan-out ─────────────────────────────────────────────────────────────
-- Índice único (webhook_id, payload->_meta->eventId) em outbound_webhook_deliveries. O fan-out passa
-- a INSERT … ON CONFLICT DO NOTHING (sem varredura por webhook, sem advisory lock). Entregas sem
-- `_meta.eventId` (NULL) não colidem entre si. Pré-voo aborta se já houver duplicata: apagar entrega
-- é decisão humana (ver o slot).

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint

-- ─── Tabela ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outbox (
  -- Identity: ordem de inserção (FIFO do relay) e chave barata para o lote.
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Chave de idempotência da mensagem. Evento de domínio: o eventId canônico do catálogo
  -- (`<conversa>:opened`, `<mensagem>:received`…). Job: o id do envelope.
  event_id text NOT NULL,
  kind text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Destino AMQP: exchange '' = fila direta (routing_key é o nome da fila).
  exchange text NOT NULL,
  routing_key text NOT NULL,
  -- Envelope pronto (`{ id, type, workspaceId, payload, ts }`), publicado byte a byte: o id do
  -- envelope é o mesmo em toda republicação.
  envelope jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT outbox_kind_chk CHECK (kind IN ('event', 'job')),
  CONSTRAINT outbox_status_chk CHECK (status IN ('pending', 'sent', 'dead')),
  CONSTRAINT outbox_exchange_chk CHECK (exchange IN ('', 'hm.events')),
  CONSTRAINT outbox_event_id_len_chk CHECK (char_length(event_id) BETWEEN 1 AND 256),
  CONSTRAINT outbox_routing_key_len_chk CHECK (char_length(routing_key) BETWEEN 1 AND 255),
  CONSTRAINT outbox_attempts_chk CHECK (attempts >= 0),
  CONSTRAINT outbox_sent_at_chk CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);
--> statement-breakpoint

-- Idempotência na origem: o mesmo evento gravado duas vezes vira uma linha.
CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_event_id ON outbox (event_id);
--> statement-breakpoint

-- Hot path do relay: pendentes em ordem de inserção. Parcial = só o que falta publicar.
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox (id) WHERE status = 'pending';
--> statement-breakpoint

-- Limpeza: enviados mais antigos primeiro.
CREATE INDEX IF NOT EXISTS idx_outbox_sent_at ON outbox (sent_at) WHERE status = 'sent';
--> statement-breakpoint

-- Mortos: alerta/inspeção e limpeza com prazo maior.
CREATE INDEX IF NOT EXISTS idx_outbox_dead ON outbox (created_at) WHERE status = 'dead';
--> statement-breakpoint

-- FK para workspaces: a exclusão do workspace apaga a fila dele (cascade).
CREATE INDEX IF NOT EXISTS idx_outbox_workspace ON outbox (workspace_id);
--> statement-breakpoint

-- ─── Acordar o relay (LISTEN/NOTIFY) ─────────────────────────────────────────────
-- Uma notificação por COMANDO (não por linha); o Postgres entrega só no COMMIT e junta as repetidas
-- da mesma transação. Rollback não notifica. Sem SECURITY DEFINER: pg_notify não exige privilégio.
CREATE OR REPLACE FUNCTION public.outbox_notify() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM pg_notify('hm_outbox', '');
  RETURN NULL;
END;
$function$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_outbox_notify ON outbox;
--> statement-breakpoint
CREATE TRIGGER trg_outbox_notify
  AFTER INSERT ON outbox
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.outbox_notify();
--> statement-breakpoint

-- ─── Privilégios ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hm_outbox_relay') THEN
    CREATE ROLE hm_outbox_relay NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
--> statement-breakpoint

REVOKE ALL ON outbox FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON outbox FROM hm_app;
--> statement-breakpoint
GRANT INSERT ON outbox TO hm_app;
--> statement-breakpoint
GRANT SELECT (event_id) ON outbox TO hm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON outbox TO hm_outbox_relay;
--> statement-breakpoint

-- O papel que aplica as migrações é o papel de conexão dos workers (e dono da tabela).
DO $$ BEGIN
  EXECUTE format('GRANT hm_outbox_relay TO %I', current_user);
END $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.outbox_notify() FROM PUBLIC;
--> statement-breakpoint

-- ─── RLS: gravação presa ao workspace da transação; leitura só do relay ─────────
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS outbox_tenant_insert ON outbox;
--> statement-breakpoint
CREATE POLICY outbox_tenant_insert ON outbox
  FOR INSERT TO hm_app
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS outbox_tenant_select ON outbox;
--> statement-breakpoint
CREATE POLICY outbox_tenant_select ON outbox
  FOR SELECT TO hm_app
  USING (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS outbox_relay_all ON outbox;
--> statement-breakpoint
CREATE POLICY outbox_relay_all ON outbox
  FOR ALL TO hm_outbox_relay
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint

-- ─── Dedup indexado do fan-out de webhooks ──────────────────────────────────────
DO $preflight$
DECLARE
  dups bigint;
BEGIN
  SELECT count(*) INTO dups FROM (
    SELECT 1
      FROM outbound_webhook_deliveries
     WHERE payload #>> '{_meta,eventId}' IS NOT NULL
     GROUP BY webhook_id, payload #>> '{_meta,eventId}'
    HAVING count(*) > 1
  ) d;
  IF dups > 0 THEN
    RAISE EXCEPTION 'F70-S16: % pares (webhook_id, eventId) duplicados em outbound_webhook_deliveries — resolva antes (ver tasks/slots/F70/F70-S16-outbox-transacional.md)', dups;
  END IF;
END
$preflight$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_webhook_deliveries_event
  ON outbound_webhook_deliveries (webhook_id, (payload #>> '{_meta,eventId}'));
