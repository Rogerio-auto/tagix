-- pgvector é pré-requisito da coluna kb_chunks.embedding vector(1536) (DATA_MODEL §8.2).
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"content_tokens" integer NOT NULL,
	"embedding" vector(1536),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_chunks_document_chunk_uq" UNIQUE("document_id","chunk_index")
);
--> statement-breakpoint
CREATE TABLE "kb_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"source_mime" text,
	"category" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"language" text DEFAULT 'pt-BR' NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"visible_to_agents" boolean DEFAULT true NOT NULL,
	"raw_content" text NOT NULL,
	"content_sha256" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "kb_documents_source_chk" CHECK ("kb_documents"."source" in ('upload','url','manual')),
	CONSTRAINT "kb_documents_status_chk" CHECK ("kb_documents"."status" in ('active','draft','archived'))
);
--> statement-breakpoint
CREATE TABLE "kb_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_id" uuid,
	"agent_id" uuid,
	"conversation_id" uuid,
	"helpful" boolean NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_document_id_kb_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_feedback" ADD CONSTRAINT "kb_feedback_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_feedback" ADD CONSTRAINT "kb_feedback_document_id_kb_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_feedback" ADD CONSTRAINT "kb_feedback_chunk_id_kb_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."kb_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_feedback" ADD CONSTRAINT "kb_feedback_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_feedback" ADD CONSTRAINT "kb_feedback_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_kb_chunks_workspace" ON "kb_chunks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_kb_chunks_document" ON "kb_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "idx_kb_documents_workspace_status" ON "kb_documents" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "idx_kb_documents_category" ON "kb_documents" USING btree ("workspace_id","category") WHERE "kb_documents"."category" is not null;--> statement-breakpoint
CREATE INDEX "idx_kb_feedback_document" ON "kb_feedback" USING btree ("document_id","created_at" DESC NULLS LAST);