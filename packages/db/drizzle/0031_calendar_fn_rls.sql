-- Custom SQL migration file, put your code below! --
-- F7-S01: funcao PL/pgSQL compute_available_slots (CALENDAR.md 3.1) + RLS do dominio Calendar.
-- Tabelas tenant (workspace_id): calendars, availability_rules, availability_exceptions,
-- events -> RLS direto. event_participants NAO tem workspace_id -> isolada via subquery em
-- events (espelha campaign_steps / flow_versions). hm_app sofre RLS; owner bypassa.

-- ─── Funcao: compute_available_slots (CALENDAR.md 3.1) ───────────────────────
-- Cruza availability_rules (janela do dia) x availability_exceptions (bloqueios) x
-- events nao-cancelados (com buffer de limpeza), aplicando min_notice a partir de now().
-- Timezone vem do workspace (nao hardcoded). STABLE: nao muta estado.
CREATE OR REPLACE FUNCTION compute_available_slots(
  p_workspace_id uuid,
  p_member_id uuid,
  p_date date,
  p_interval_minutes integer DEFAULT 60,
  p_min_notice_minutes integer DEFAULT 30,
  p_buffer_minutes integer DEFAULT 15,         -- NOVO no v2: buffer entre eventos
  p_max_slots integer DEFAULT 10
)
RETURNS TABLE (start_at timestamptz, end_at timestamptz, duration_minutes integer)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_tz text;
  v_dow integer;
  v_now timestamptz := now();
BEGIN
  -- 1. Timezone do member (via workspace fallback)
  SELECT w.timezone INTO v_tz
  FROM workspaces w
  WHERE w.id = p_workspace_id;

  -- 2. Day of week da data-alvo (PG: 0=Sunday). p_date ja e a data civil no fuso
  --    do workspace; aplicar AT TIME ZONE aqui deslocaria p/ o dia anterior.
  v_dow := EXTRACT(DOW FROM p_date);

  RETURN QUERY
  WITH rules AS (
    SELECT
      ar.start_time,
      ar.end_time
    FROM availability_rules ar
    WHERE ar.member_id = p_member_id
      AND ar.day_of_week = v_dow
      AND ar.is_active = true
      AND ar.is_available = true
  ),
  base_slots AS (
    -- Wall-clock da janela do dia interpretado no fuso do workspace (-> timestamptz).
    SELECT
      gs.slot_start AS start_at,
      (gs.slot_start + (p_interval_minutes || ' minutes')::interval) AS end_at
    FROM rules r,
      LATERAL generate_series(
        ((p_date + r.start_time) AT TIME ZONE v_tz),
        ((p_date + r.end_time) AT TIME ZONE v_tz) - (p_interval_minutes || ' minutes')::interval,
        (p_interval_minutes || ' minutes')::interval
      ) AS gs(slot_start)
  ),
  not_in_exception AS (
    SELECT bs.*
    FROM base_slots bs
    WHERE NOT EXISTS (
      SELECT 1 FROM availability_exceptions ae
      WHERE ae.member_id = p_member_id
        AND ae.is_available = false
        AND tstzrange(
          (ae.start_date + COALESCE(ae.start_time, '00:00')) AT TIME ZONE v_tz,
          (ae.end_date + COALESCE(ae.end_time, '23:59')) AT TIME ZONE v_tz
        ) && tstzrange(bs.start_at, bs.end_at)
    )
  ),
  not_conflicting AS (
    SELECT nie.*
    FROM not_in_exception nie
    WHERE NOT EXISTS (
      SELECT 1 FROM events e
      JOIN event_participants ep ON ep.event_id = e.id
      WHERE ep.member_id = p_member_id
        AND e.status != 'cancelled'
        AND tstzrange(
          e.start_at - (p_buffer_minutes || ' minutes')::interval,
          e.end_at + (p_buffer_minutes || ' minutes')::interval
        ) && tstzrange(nie.start_at, nie.end_at)
    )
  )
  SELECT
    nc.start_at,
    nc.end_at,
    p_interval_minutes AS duration_minutes
  FROM not_conflicting nc
  WHERE nc.start_at >= v_now + (p_min_notice_minutes || ' minutes')::interval
  ORDER BY nc.start_at
  LIMIT p_max_slots;
END;
$$;
--> statement-breakpoint

-- hm_app precisa executar a funcao (DEFAULT PRIVILEGES cobre tabelas/sequences,
-- nao funcoes). SECURITY INVOKER (default) -> a RLS do caller continua valendo.
GRANT EXECUTE ON FUNCTION compute_available_slots(uuid, uuid, date, integer, integer, integer, integer) TO hm_app;
--> statement-breakpoint

-- ─── RLS: tabelas com workspace_id proprio ───────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON calendars TO hm_app;
ALTER TABLE calendars ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendars_isolation ON calendars
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON availability_rules TO hm_app;
ALTER TABLE availability_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY availability_rules_isolation ON availability_rules
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON availability_exceptions TO hm_app;
ALTER TABLE availability_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY availability_exceptions_isolation ON availability_exceptions
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON events TO hm_app;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_isolation ON events
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

-- event_participants: sem workspace_id proprio -> isola via evento dono
GRANT SELECT, INSERT, UPDATE, DELETE ON event_participants TO hm_app;
ALTER TABLE event_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_participants_isolation ON event_participants
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_participants.event_id
        AND e.workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_participants.event_id
        AND e.workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  );
--> statement-breakpoint
