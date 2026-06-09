CREATE TABLE "platform_secrets" (
	"key" text PRIMARY KEY NOT NULL,
	"value_enc" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
