-- F37-S01 — Calendar 2.0: colunas de recorrencia em `events`.
-- Tudo nullable -> retrocompat (eventos existentes ficam com recurrence_rule NULL =
-- sem recorrencia). `events` ja tem RLS habilitada (0030/0031) -> nenhuma policy nova
-- e necessaria; as colunas herdam o isolamento por workspace existente.
ALTER TABLE "events" ADD COLUMN "recurrence_rule" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "recurrence_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "recurrence_parent_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_recurrence_parent_id_events_id_fk" FOREIGN KEY ("recurrence_parent_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_events_recurrence" ON "events" USING btree ("workspace_id") WHERE "events"."recurrence_rule" is not null;--> statement-breakpoint
CREATE INDEX "idx_events_recurrence_parent" ON "events" USING btree ("recurrence_parent_id") WHERE "events"."recurrence_parent_id" is not null;
