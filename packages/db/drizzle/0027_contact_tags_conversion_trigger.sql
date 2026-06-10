-- Custom SQL migration file, put your code below! --
-- F5-S14: trigger pg em contact_tags (AFTER INSERT) que registra conversao
-- automatica quando a tag aplicada esta mapeada em conversion_tag_triggers.
-- Idempotente: o ON CONFLICT DO NOTHING respeita o dedup same-day
-- (uq_conv_events_dedup). Roda como definer/owner (SECURITY DEFINER nao e
-- necessario: o trigger executa no mesmo contexto do INSERT, que ja preencheu
-- contact_tags.workspace_id denormalizado).

CREATE OR REPLACE FUNCTION fn_contact_tags_register_conversion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO conversion_events (
    workspace_id, conversion_type_id, contact_id, source, occurred_at, metadata
  )
  SELECT
    NEW.workspace_id,
    ctt.conversion_type_id,
    NEW.contact_id,
    'tag_added',
    now(),
    jsonb_build_object('tag_id', NEW.tag_id)
  FROM conversion_tag_triggers ctt
  WHERE ctt.workspace_id = NEW.workspace_id
    AND ctt.tag_id = NEW.tag_id
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_contact_tags_register_conversion
  AFTER INSERT ON contact_tags
  FOR EACH ROW
  EXECUTE FUNCTION fn_contact_tags_register_conversion();
