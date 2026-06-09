CREATE TABLE "channel_secrets" (
	"channel_id" uuid PRIMARY KEY NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"app_secret_enc" text,
	"api_key_enc" text,
	"key_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"display_handle" text,
	"phone_number" text,
	"phone_number_id" text,
	"waba_id" text,
	"ig_user_id" text,
	"ig_username" text,
	"ig_account_type" text,
	"fb_page_id" text,
	"waha_session_id" text,
	"webhook_verify_token" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "channels_provider_chk" CHECK ("channels"."provider" in ('meta_whatsapp','meta_instagram','waha')),
	CONSTRAINT "channels_ig_account_type_chk" CHECK ("channels"."ig_account_type" in ('business','creator') or "channels"."ig_account_type" is null),
	CONSTRAINT "channels_provider_columns" CHECK (("channels"."provider" = 'meta_whatsapp' and "channels"."phone_number_id" is not null and "channels"."waba_id" is not null)
       or ("channels"."provider" = 'meta_instagram' and "channels"."ig_user_id" is not null and "channels"."fb_page_id" is not null)
       or ("channels"."provider" = 'waha' and "channels"."waha_session_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "channel_secrets" ADD CONSTRAINT "channel_secrets_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_channels_phone_number_id" ON "channels" USING btree ("phone_number_id") WHERE "channels"."phone_number_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_channels_ig_user_id" ON "channels" USING btree ("ig_user_id") WHERE "channels"."ig_user_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_channels_workspace" ON "channels" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_channels_provider" ON "channels" USING btree ("workspace_id","provider") WHERE "channels"."is_active" = true;