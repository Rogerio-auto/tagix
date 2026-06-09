CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"display_name" text,
	"phone" text,
	"email" "citext",
	"avatar_url" text,
	"notes" text,
	"language" text DEFAULT 'pt-BR',
	"source" text,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"opt_in_method" text,
	"opt_in_source" text,
	"opt_in_at" timestamp with time zone,
	"opt_out_at" timestamp with time zone,
	"opt_out_reason" text,
	"owner_id" uuid,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "contacts_opt_in_method_chk" CHECK ("contacts"."opt_in_method" in ('whatsapp','website','checkout','import','manual','api') or "contacts"."opt_in_method" is null)
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"contact_id" uuid,
	"remote_id" text NOT NULL,
	"kind" text DEFAULT 'direct' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"ai_mode" text DEFAULT 'off' NOT NULL,
	"assigned_to" uuid,
	"department_id" uuid,
	"team_id" uuid,
	"agent_id" uuid,
	"group_name" text,
	"group_avatar_url" text,
	"last_message_id" uuid,
	"last_message_preview" text,
	"last_message_at" timestamp with time zone,
	"last_message_from" text,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"snoozed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "conversations_kind_chk" CHECK ("conversations"."kind" in ('direct','group','story_thread','comment_thread')),
	CONSTRAINT "conversations_status_chk" CHECK ("conversations"."status" in ('open','pending','closed','resolved','snoozed')),
	CONSTRAINT "conversations_ai_mode_chk" CHECK ("conversations"."ai_mode" in ('off','on','paused')),
	CONSTRAINT "conversations_last_from_chk" CHECK ("conversations"."last_message_from" in ('contact','member','agent','system') or "conversations"."last_message_from" is null)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"external_id" text,
	"direction" text NOT NULL,
	"sender_type" text NOT NULL,
	"sender_member_id" uuid,
	"sender_agent_id" uuid,
	"type" text DEFAULT 'text' NOT NULL,
	"content" text,
	"view_status" text DEFAULT 'pending' NOT NULL,
	"failed_reason" text,
	"media_url" text,
	"media_mime" text,
	"media_size_bytes" bigint,
	"media_sha256" text,
	"media_caption" text,
	"interactive_payload" jsonb,
	"reply_to_message_id" uuid,
	"reaction_emoji" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "messages_direction_chk" CHECK ("messages"."direction" in ('inbound','outbound')),
	CONSTRAINT "messages_sender_type_chk" CHECK ("messages"."sender_type" in ('contact','member','agent','system')),
	CONSTRAINT "messages_view_status_chk" CHECK ("messages"."view_status" in ('pending','sending','sent','delivered','read','failed','deleted')),
	CONSTRAINT "messages_type_chk" CHECK ("messages"."type" in ('text','image','video','audio','voice','document','sticker','location','contact','interactive','template','reaction','system','story_mention','story_reply','share','comment','comment_reply','ig_postback','referral'))
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_id_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_to_members_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_member_id_members_id_fk" FOREIGN KEY ("sender_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_message_id_messages_id_fk" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contacts_workspace_phone" ON "contacts" USING btree ("workspace_id","phone") WHERE "contacts"."phone" is not null and "contacts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_contacts_workspace_name" ON "contacts" USING btree ("workspace_id","display_name");--> statement-breakpoint
CREATE INDEX "idx_contacts_owner" ON "contacts" USING btree ("owner_id") WHERE "contacts"."owner_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_contacts_opt_in" ON "contacts" USING btree ("workspace_id","marketing_opt_in");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_conversations_channel_remote" ON "conversations" USING btree ("channel_id","remote_id");--> statement-breakpoint
CREATE INDEX "idx_conversations_ws_status_lastmsg" ON "conversations" USING btree ("workspace_id","status","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_conversations_assigned" ON "conversations" USING btree ("assigned_to") WHERE "conversations"."assigned_to" is not null;--> statement-breakpoint
CREATE INDEX "idx_conversations_contact" ON "conversations" USING btree ("contact_id") WHERE "conversations"."contact_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_messages_external" ON "messages" USING btree ("conversation_id","external_id") WHERE "messages"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_messages_conversation_created" ON "messages" USING btree ("conversation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_messages_workspace_created" ON "messages" USING btree ("workspace_id","created_at" DESC NULLS LAST);