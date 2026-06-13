CREATE TABLE "conversation_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"agent_id" uuid,
	"primary_member_id" uuid,
	"handled_by" text NOT NULL,
	"quality_score" smallint NOT NULL,
	"quality_rationale" text,
	"sentiment_score" smallint,
	"csat_label" text,
	"judge_model" text NOT NULL,
	"judge_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_evaluations_conversation_uq" UNIQUE("conversation_id"),
	CONSTRAINT "conversation_evaluations_handled_by_chk" CHECK ("conversation_evaluations"."handled_by" in ('ai','human','mixed')),
	CONSTRAINT "conversation_evaluations_quality_chk" CHECK ("conversation_evaluations"."quality_score" between 0 and 100),
	CONSTRAINT "conversation_evaluations_sentiment_chk" CHECK ("conversation_evaluations"."sentiment_score" is null or "conversation_evaluations"."sentiment_score" between -100 and 100),
	CONSTRAINT "conversation_evaluations_csat_chk" CHECK ("conversation_evaluations"."csat_label" is null or "conversation_evaluations"."csat_label" in ('promoter','neutral','detractor'))
);
--> statement-breakpoint
CREATE TABLE "objections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"category" text NOT NULL,
	"label" text NOT NULL,
	"excerpt" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "objections_category_chk" CHECK ("objections"."category" in ('price','timing','trust','competitor','feature_gap','authority','other'))
);
--> statement-breakpoint
ALTER TABLE "conversation_evaluations" ADD CONSTRAINT "conversation_evaluations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_evaluations" ADD CONSTRAINT "conversation_evaluations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_evaluations" ADD CONSTRAINT "conversation_evaluations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_evaluations" ADD CONSTRAINT "conversation_evaluations_primary_member_id_members_id_fk" FOREIGN KEY ("primary_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objections" ADD CONSTRAINT "objections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objections" ADD CONSTRAINT "objections_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objections" ADD CONSTRAINT "objections_evaluation_id_conversation_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."conversation_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_conv_eval_ws_evaluated" ON "conversation_evaluations" USING btree ("workspace_id","evaluated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_conv_eval_ws_agent" ON "conversation_evaluations" USING btree ("workspace_id","agent_id");--> statement-breakpoint
CREATE INDEX "idx_conv_eval_ws_member" ON "conversation_evaluations" USING btree ("workspace_id","primary_member_id");--> statement-breakpoint
CREATE INDEX "idx_objections_ws_category" ON "objections" USING btree ("workspace_id","category");--> statement-breakpoint
CREATE INDEX "idx_objections_ws_occurred" ON "objections" USING btree ("workspace_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_objections_evaluation" ON "objections" USING btree ("evaluation_id");