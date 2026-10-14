-- F58-S12 — Nenhuma mensagem de campanha se perde, nenhuma sai de campanha parada.
--
-- ─── Contexto ────────────────────────────────────────────────────────────────────
-- O disparo de campanha já grava delivery, mensagem, avanço do recipient e o job de outbound
-- (outbox transacional da F70-S16, migração 0086) numa transação só, e o relay dos workers
-- publica com publisher confirms, retry com backoff e `dead` observável. Esta migração NÃO cria
-- uma segunda outbox: reusa a genérica e fecha as duas lacunas que sobravam.
--
-- 1. Pausar/cancelar não segurava o que ainda não tinha sido publicado. Com o broker fora (ou
--    com o relay atrasado), os jobs da campanha esperam na outbox; ao voltar, saíam mesmo com a
--    campanha pausada ou cancelada. Agora a transição de status da campanha (quem quer que a
--    faça: API, auto-pausa do tick, pausa por modelo recusado no outbound) aplica a regra NO
--    BANCO, na mesma transação do UPDATE:
--      running -> paused        : jobs ainda não publicados ficam RETIDOS (available_at = infinity;
--                                 o relay só reivindica available_at <= now()).
--      paused  -> running       : os retidos são LIBERADOS (available_at = now()) e o relay acorda.
--      * -> cancelled, ou paused -> qualquer status que não seja running: os não publicados são
--                                 DESCARTADOS; delivery e mensagem viram `failed`
--                                 (`campaign_cancelled`), visíveis no relatório e no chat.
--    Jobs que JÁ estavam no broker não podem ser recolhidos: são QUANTIFICADOS. Cada transição
--    grava em audit_logs (action `campaign.outbox_gated`) `{ transition, held | released |
--    dropped, inFlight }` — inFlight = deliveries `queued` cujo job já saiu da outbox. A rota de
--    pausa/cancelamento lê esse registro na mesma transação para responder ao usuário.
--
--    A linha que o relay está publicando no instante da pausa está travada (FOR UPDATE SKIP
--    LOCKED do relay). O UPDATE daqui ESPERA essa transação (no máximo o prazo de confirmação) e
--    reavalia: se ela foi publicada, conta como inFlight; se voltou com backoff, é retida. Não há
--    janela em que um job escape da retenção. Sem risco de deadlock: o relay só trava linhas da
--    outbox, nunca `campaigns`.
--
-- 2. O resultado do outbound não voltava à delivery sem o webhook. O índice abaixo serve o
--    UPDATE direto do worker outbound (e a correlação mensagem -> delivery desta função).
--
-- ─── Acesso (decisão de segurança) ────────────────────────────────────────────────
-- A função é SECURITY DEFINER porque o `hm_app` (API) não lê nem altera a outbox (0086/0091).
-- Ela roda como o dono (membro de `hm_outbox_relay`) e fica presa ao workspace da CAMPANHA:
--   * fixa `app.workspace_id` = NEW.workspace_id durante a execução e restaura o valor anterior
--     no fim — a RLS FORCE de campaign_deliveries/messages/audit_logs vale para o dono e enxerga
--     só esse tenant; todo filtro também carrega workspace_id explícito;
--   * só toca linhas `job` da fila `hm.q.outbound` cujo `messageId` é de delivery `queued` DESTA
--     campanha. Não recebe argumento: não há como apontá-la para outro tenant.
--   * search_path fixo; EXECUTE revogado de PUBLIC (trigger não exige EXECUTE do invocador).

CREATE INDEX IF NOT EXISTS idx_campaign_deliveries_message
  ON campaign_deliveries (message_id)
  WHERE message_id IS NOT NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.campaign_outbox_gate() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  prev_ws text := current_setting('app.workspace_id', true);
  v_mode text;
  v_count integer := 0;
  v_queued integer := 0;
  v_pending integer := 0;
  v_dropped uuid[];
BEGIN
  IF NEW.status = 'paused' THEN
    v_mode := 'held';
  ELSIF NEW.status = 'running' AND OLD.status = 'paused' THEN
    v_mode := 'released';
  ELSIF NEW.status = 'cancelled' OR OLD.status = 'paused' THEN
    v_mode := 'dropped';
  ELSE
    RETURN NULL;
  END IF;

  PERFORM set_config('app.workspace_id', NEW.workspace_id::text, true);

  IF v_mode = 'held' THEN
    UPDATE public.outbox AS o
       SET available_at = 'infinity'::timestamptz
     WHERE o.workspace_id = NEW.workspace_id
       AND o.status = 'pending'
       AND o.kind = 'job'
       AND o.routing_key = 'hm.q.outbound'
       AND o.available_at <> 'infinity'::timestamptz
       AND (o.envelope #>> '{payload,messageId}') IN (
             SELECT d.message_id::text
               FROM public.campaign_deliveries AS d
              WHERE d.workspace_id = NEW.workspace_id
                AND d.campaign_id = NEW.id
                AND d.status = 'queued'
                AND d.message_id IS NOT NULL);
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF v_mode = 'released' THEN
    UPDATE public.outbox AS o
       SET available_at = now()
     WHERE o.workspace_id = NEW.workspace_id
       AND o.status = 'pending'
       AND o.kind = 'job'
       AND o.routing_key = 'hm.q.outbound'
       AND o.available_at = 'infinity'::timestamptz
       AND (o.envelope #>> '{payload,messageId}') IN (
             SELECT d.message_id::text
               FROM public.campaign_deliveries AS d
              WHERE d.workspace_id = NEW.workspace_id
                AND d.campaign_id = NEW.id
                AND d.status = 'queued'
                AND d.message_id IS NOT NULL);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    -- Acorda o relay já (pg_notify só entrega no COMMIT; rollback não acorda ninguém).
    IF v_count > 0 THEN
      PERFORM pg_notify('hm_outbox', '');
    END IF;

  ELSE
    WITH gone AS (
      DELETE FROM public.outbox AS o
       WHERE o.workspace_id = NEW.workspace_id
         AND o.status = 'pending'
         AND o.kind = 'job'
         AND o.routing_key = 'hm.q.outbound'
         AND (o.envelope #>> '{payload,messageId}') IN (
               SELECT d.message_id::text
                 FROM public.campaign_deliveries AS d
                WHERE d.workspace_id = NEW.workspace_id
                  AND d.campaign_id = NEW.id
                  AND d.status = 'queued'
                  AND d.message_id IS NOT NULL)
      RETURNING (o.envelope #>> '{payload,messageId}')::uuid AS message_id
    )
    SELECT coalesce(array_agg(message_id), '{}') INTO v_dropped FROM gone;
    v_count := coalesce(array_length(v_dropped, 1), 0);

    IF v_count > 0 THEN
      UPDATE public.campaign_deliveries AS d
         SET status = 'failed',
             error_code = 'campaign_cancelled',
             error_message = 'A campanha foi encerrada antes de esta mensagem sair.',
             failed_at = now()
       WHERE d.workspace_id = NEW.workspace_id
         AND d.campaign_id = NEW.id
         AND d.status = 'queued'
         AND d.message_id = ANY (v_dropped);

      UPDATE public.messages AS m
         SET view_status = 'failed',
             failed_reason = 'campaign_cancelled',
             updated_at = now()
       WHERE m.workspace_id = NEW.workspace_id
         AND m.id = ANY (v_dropped)
         AND m.view_status = 'pending';
    END IF;
  END IF;

  -- Quantos jobs desta campanha já saíram da outbox e ainda não têm desfecho (estão no broker
  -- ou no worker outbound): não dá para recolher, mas o usuário precisa saber quantos são.
  SELECT count(*) INTO v_queued
    FROM public.campaign_deliveries AS d
   WHERE d.workspace_id = NEW.workspace_id
     AND d.campaign_id = NEW.id
     AND d.status = 'queued'
     AND d.message_id IS NOT NULL;

  SELECT count(*) INTO v_pending
    FROM public.outbox AS o
   WHERE o.workspace_id = NEW.workspace_id
     AND o.status = 'pending'
     AND o.kind = 'job'
     AND o.routing_key = 'hm.q.outbound'
     AND (o.envelope #>> '{payload,messageId}') IN (
           SELECT d.message_id::text
             FROM public.campaign_deliveries AS d
            WHERE d.workspace_id = NEW.workspace_id
              AND d.campaign_id = NEW.id
              AND d.status = 'queued'
              AND d.message_id IS NOT NULL);

  IF v_count > 0 OR v_queued > v_pending THEN
    INSERT INTO public.audit_logs (workspace_id, actor_type, action, resource_type, resource_id, metadata)
    VALUES (
      NEW.workspace_id,
      'system',
      'campaign.outbox_gated',
      'campaign',
      NEW.id,
      jsonb_build_object(
        'transition', OLD.status || '->' || NEW.status,
        v_mode, v_count,
        'inFlight', greatest(v_queued - v_pending, 0)
      )
    );
  END IF;

  PERFORM set_config('app.workspace_id', coalesce(prev_ws, ''), true);
  RETURN NULL;
END;
$function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.campaign_outbox_gate() FROM PUBLIC;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_campaign_outbox_gate ON campaigns;
--> statement-breakpoint

CREATE TRIGGER trg_campaign_outbox_gate
  AFTER UPDATE OF status ON campaigns
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.campaign_outbox_gate();
