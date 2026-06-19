-- F43-S01: Onboarding & Verticalização (ONBOARDING.md §2.1/§3.1).
--
-- 1) Tabela quick_replies (respostas rápidas do LiveChat, workspace-scoped).
-- 2) Colunas jsonb de estado de first-run: workspaces.onboarding + members.tour_state.
-- RLS de quick_replies fica na migration custom dedicada (0048); onboarding/tour_state
-- herdam o RLS já existente de workspaces/members.

-- ── workspaces.onboarding: { niche_key, applied_at, survey, setup_completed } ──
ALTER TABLE "workspaces" ADD COLUMN "onboarding" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

-- ── members.tour_state: { <tourId>: { completed_at, dismissed } } ──
ALTER TABLE "members" ADD COLUMN "tour_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

-- ── quick_replies: respostas rápidas (UNIQUE workspace+title = âncora idempotente) ──
CREATE TABLE "quick_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"department_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "quick_replies_workspace_title_uq" UNIQUE("workspace_id","title")
);
--> statement-breakpoint
ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_quick_replies_workspace" ON "quick_replies" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_quick_replies_department" ON "quick_replies" USING btree ("department_id") WHERE "quick_replies"."department_id" is not null;
