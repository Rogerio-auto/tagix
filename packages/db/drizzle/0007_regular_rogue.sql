CREATE TABLE "ig_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"media_id" text,
	"comment_id" text,
	"parent_comment_id" text,
	"from_igsid" text,
	"from_username" text,
	"text" text,
	"media_kind" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "ig_comments_media_kind_chk" CHECK ("ig_comments"."media_kind" in ('post','reel','story') or "ig_comments"."media_kind" is null)
);
--> statement-breakpoint
ALTER TABLE "ig_comments" ADD CONSTRAINT "ig_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_comments" ADD CONSTRAINT "ig_comments_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ig_comments_channel_comment" ON "ig_comments" USING btree ("channel_id","comment_id") WHERE "ig_comments"."comment_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_ig_comments_workspace" ON "ig_comments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_ig_comments_channel_media" ON "ig_comments" USING btree ("channel_id","media_id");--> statement-breakpoint
CREATE INDEX "idx_ig_comments_parent" ON "ig_comments" USING btree ("parent_comment_id") WHERE "ig_comments"."parent_comment_id" is not null;