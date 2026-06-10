CREATE TABLE "routing_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_member_id" uuid,
	"to_member_id" uuid,
	"from_department" uuid,
	"to_department" uuid,
	"reason" text,
	"actor_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routing_history_action_chk" CHECK ("routing_history"."action" in ('assign','unassign','transfer_member','transfer_department','auto_assign'))
);
--> statement-breakpoint
ALTER TABLE "routing_history" ADD CONSTRAINT "routing_history_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_history" ADD CONSTRAINT "routing_history_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_history" ADD CONSTRAINT "routing_history_from_member_id_members_id_fk" FOREIGN KEY ("from_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_history" ADD CONSTRAINT "routing_history_to_member_id_members_id_fk" FOREIGN KEY ("to_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_history" ADD CONSTRAINT "routing_history_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_routing_history_conversation_created" ON "routing_history" USING btree ("conversation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_routing_history_workspace_created" ON "routing_history" USING btree ("workspace_id","created_at" DESC NULLS LAST);