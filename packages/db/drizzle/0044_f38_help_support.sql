-- F38-S01: Central de Ajuda (CMS global) + Chat de Suporte (workspace-scoped).
-- Schema + FTS GIN. RLS fica na migration custom dedicada (0045).

CREATE TABLE "help_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"icon" text,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "help_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "help_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"body_md" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"anchor_key" text,
	"search_tsv" tsvector GENERATED ALWAYS AS (
		setweight(to_tsvector('portuguese', coalesce("title", '')), 'A') ||
		setweight(to_tsvector('portuguese', coalesce("excerpt", '')), 'B') ||
		setweight(to_tsvector('portuguese', coalesce("body_md", '')), 'C')
	) STORED,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "help_articles_slug_unique" UNIQUE("slug"),
	CONSTRAINT "help_articles_anchor_key_uq" UNIQUE("anchor_key"),
	CONSTRAINT "help_articles_status_chk" CHECK ("help_articles"."status" in ('draft','published'))
);
--> statement-breakpoint
CREATE TABLE "help_article_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"helpful" boolean NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "help_article_feedback_article_member_uq" UNIQUE("article_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "support_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opened_by" uuid,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assigned_to" uuid,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "support_threads_status_chk" CHECK ("support_threads"."status" in ('open','pending','resolved')),
	CONSTRAINT "support_threads_priority_chk" CHECK ("support_threads"."priority" in ('low','normal','high')),
	CONSTRAINT "support_threads_subject_not_empty_chk" CHECK (length(btrim("support_threads"."subject")) > 0)
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_type" text NOT NULL,
	"sender_id" uuid,
	"body" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_messages_sender_type_chk" CHECK ("support_messages"."sender_type" in ('member','platform')),
	CONSTRAINT "support_messages_body_not_empty_chk" CHECK (length(btrim("support_messages"."body")) > 0)
);
--> statement-breakpoint
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_category_id_help_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."help_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_updated_by_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_article_feedback" ADD CONSTRAINT "help_article_feedback_article_id_help_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."help_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_article_feedback" ADD CONSTRAINT "help_article_feedback_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_article_feedback" ADD CONSTRAINT "help_article_feedback_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_opened_by_members_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_thread_id_support_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."support_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_help_categories_order" ON "help_categories" USING btree ("order");--> statement-breakpoint
CREATE INDEX "idx_help_articles_status_category_order" ON "help_articles" USING btree ("status","category_id","order");--> statement-breakpoint
CREATE INDEX "idx_help_articles_search_tsv" ON "help_articles" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "idx_help_article_feedback_article" ON "help_article_feedback" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "idx_help_article_feedback_workspace" ON "help_article_feedback" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_support_threads_workspace_last_message" ON "support_threads" USING btree ("workspace_id","last_message_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_support_threads_status_last_message" ON "support_threads" USING btree ("status","last_message_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_support_messages_thread_created" ON "support_messages" USING btree ("thread_id","created_at");
