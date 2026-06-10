CREATE TABLE "agent_template_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"help" text,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_template_questions_template_key_uq" UNIQUE("template_id","key"),
	CONSTRAINT "agent_template_questions_type_chk" CHECK ("agent_template_questions"."type" in ('text','textarea','select','number','boolean','multiselect'))
);
--> statement-breakpoint
CREATE TABLE "agent_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"prompt_template" text NOT NULL,
	"default_model" text NOT NULL,
	"default_model_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_tools" text[] DEFAULT '{}' NOT NULL,
	"industry" text,
	"is_global" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "agent_templates_workspace_key_uq" UNIQUE("workspace_id","key")
);
--> statement-breakpoint
CREATE TABLE "agent_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"period" text NOT NULL,
	"period_start" date NOT NULL,
	"total_conversations" integer DEFAULT 0 NOT NULL,
	"total_messages" integer DEFAULT 0 NOT NULL,
	"total_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"avg_latency_ms" integer DEFAULT 0,
	"handoff_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_metrics_agent_period_uq" UNIQUE("agent_id","period","period_start"),
	CONSTRAINT "agent_metrics_period_chk" CHECK ("agent_metrics"."period" in ('day','week','month'))
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"template_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"system_prompt" text NOT NULL,
	"model" text DEFAULT 'openai/gpt-4o-mini' NOT NULL,
	"model_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"vision_model" text DEFAULT 'gpt-4o',
	"transcription_model" text DEFAULT 'whisper-1',
	"status" text DEFAULT 'active' NOT NULL,
	"aggregation_enabled" boolean DEFAULT true NOT NULL,
	"aggregation_window_sec" integer DEFAULT 20 NOT NULL,
	"max_batch_messages" integer DEFAULT 20 NOT NULL,
	"reply_if_idle_sec" integer,
	"allow_handoff" boolean DEFAULT true NOT NULL,
	"ignore_group_messages" boolean DEFAULT true NOT NULL,
	"enabled_channel_ids" uuid[] DEFAULT '{}' NOT NULL,
	"api_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "agents_status_chk" CHECK ("agents"."status" in ('active','inactive','archived'))
);
--> statement-breakpoint
CREATE TABLE "workspace_agent_policies" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"allowed_models" text[] DEFAULT '{}' NOT NULL,
	"default_chat_model" text,
	"allow_streaming" boolean DEFAULT true NOT NULL,
	"allow_interrupts" boolean DEFAULT false NOT NULL,
	"allow_parallel_tools" boolean DEFAULT true NOT NULL,
	"allow_vision" boolean DEFAULT false NOT NULL,
	"allow_transcription" boolean DEFAULT false NOT NULL,
	"allow_persistent_checkpoints" boolean DEFAULT true NOT NULL,
	"allow_agent_conversions" boolean DEFAULT false NOT NULL,
	"agent_conversion_require_approval" boolean DEFAULT true NOT NULL,
	"max_iterations" integer DEFAULT 5 NOT NULL,
	"max_tools_per_agent" integer DEFAULT 20 NOT NULL,
	"max_tokens_per_call" integer DEFAULT 8000 NOT NULL,
	"max_monthly_cost_usd" numeric(10, 2),
	"max_daily_invocations" integer,
	"allowed_tool_categories" text[] DEFAULT ARRAY['database','workflow','calendar','knowledge']::text[] NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_tools" (
	"agent_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_tools_agent_id_tool_id_pk" PRIMARY KEY("agent_id","tool_id")
);
--> statement-breakpoint
CREATE TABLE "tool_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid,
	"tool_id" uuid NOT NULL,
	"conversation_id" uuid,
	"contact_id" uuid,
	"execution_id" uuid,
	"action" text NOT NULL,
	"table_name" text,
	"columns_accessed" text[],
	"params" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"duration_ms" integer,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"schema" jsonb NOT NULL,
	"handler_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_global" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "tools_workspace_key_uq" UNIQUE("workspace_id","key"),
	CONSTRAINT "tools_category_chk" CHECK ("tools"."category" in ('database','http','workflow','calendar','knowledge'))
);
--> statement-breakpoint
CREATE TABLE "agent_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"conversation_id" uuid,
	"thread_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"current_node" text,
	"state" jsonb NOT NULL,
	"total_tokens" integer DEFAULT 0,
	"total_cost_usd" numeric(10, 6) DEFAULT '0',
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "agent_executions_status_chk" CHECK ("agent_executions"."status" in ('running','interrupted','completed','failed'))
);
--> statement-breakpoint
CREATE TABLE "llm_models_whitelist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"upstream_provider" text NOT NULL,
	"context_length" integer,
	"supports_tools" boolean DEFAULT true NOT NULL,
	"supports_vision" boolean DEFAULT false NOT NULL,
	"supports_streaming" boolean DEFAULT true NOT NULL,
	"pricing_prompt_per_1m" numeric(12, 6),
	"pricing_completion_per_1m" numeric(12, 6),
	"is_active" boolean DEFAULT true NOT NULL,
	"default_plan_keys" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "llm_models_whitelist_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "llm_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid,
	"conversation_id" uuid,
	"execution_id" uuid,
	"request_type" text NOT NULL,
	"router" text DEFAULT 'openrouter' NOT NULL,
	"openrouter_generation_id" text,
	"upstream_provider" text,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 8) DEFAULT '0' NOT NULL,
	"latency_ms" integer,
	"finish_reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_usage_logs_request_type_chk" CHECK ("llm_usage_logs"."request_type" in ('chat','transcription','vision','embedding','tts','dalle','rerank')),
	CONSTRAINT "llm_usage_logs_router_chk" CHECK ("llm_usage_logs"."router" in ('openrouter','openai_direct'))
);
--> statement-breakpoint
ALTER TABLE "agent_template_questions" ADD CONSTRAINT "agent_template_questions_template_id_agent_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agent_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_templates" ADD CONSTRAINT "agent_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_metrics" ADD CONSTRAINT "agent_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_metrics" ADD CONSTRAINT "agent_metrics_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_template_id_agent_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agent_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_agent_policies" ADD CONSTRAINT "workspace_agent_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_agent_policies" ADD CONSTRAINT "workspace_agent_policies_updated_by_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tools" ADD CONSTRAINT "agent_tools_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tools" ADD CONSTRAINT "agent_tools_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_logs" ADD CONSTRAINT "tool_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_logs" ADD CONSTRAINT "tool_logs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_logs" ADD CONSTRAINT "tool_logs_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_logs" ADD CONSTRAINT "tool_logs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_logs" ADD CONSTRAINT "tool_logs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage_logs" ADD CONSTRAINT "llm_usage_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage_logs" ADD CONSTRAINT "llm_usage_logs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage_logs" ADD CONSTRAINT "llm_usage_logs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_templates_global" ON "agent_templates" USING btree ("is_global") WHERE "agent_templates"."is_global" = true;--> statement-breakpoint
CREATE INDEX "idx_agent_metrics_workspace_period" ON "agent_metrics" USING btree ("workspace_id","period","period_start" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_agents_workspace_status" ON "agents" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "idx_agents_template" ON "agents" USING btree ("template_id") WHERE "agents"."template_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_tool_logs_workspace_executed" ON "tool_logs" USING btree ("workspace_id","executed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_tool_logs_agent" ON "tool_logs" USING btree ("agent_id","executed_at" DESC NULLS LAST) WHERE "tool_logs"."agent_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_tool_logs_conversation" ON "tool_logs" USING btree ("conversation_id") WHERE "tool_logs"."conversation_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_tools_global" ON "tools" USING btree ("is_global") WHERE "tools"."is_global" = true;--> statement-breakpoint
CREATE INDEX "idx_agent_executions_thread" ON "agent_executions" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_agent_executions_conversation" ON "agent_executions" USING btree ("conversation_id") WHERE "agent_executions"."conversation_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_agent_executions_agent_started" ON "agent_executions" USING btree ("agent_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_llm_models_active" ON "llm_models_whitelist" USING btree ("is_active") WHERE "llm_models_whitelist"."is_active" = true;--> statement-breakpoint
CREATE INDEX "idx_llm_usage_workspace_created" ON "llm_usage_logs" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_llm_usage_model_created" ON "llm_usage_logs" USING btree ("model","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_llm_usage_agent_created" ON "llm_usage_logs" USING btree ("agent_id","created_at" DESC NULLS LAST) WHERE "llm_usage_logs"."agent_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_llm_usage_openrouter_generation" ON "llm_usage_logs" USING btree ("openrouter_generation_id") WHERE "llm_usage_logs"."openrouter_generation_id" is not null;