CREATE TABLE "agent_departments" (
	"agent_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_departments_agent_id_department_id_pk" PRIMARY KEY("agent_id","department_id")
);
--> statement-breakpoint
ALTER TABLE "agent_departments" ADD CONSTRAINT "agent_departments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_departments" ADD CONSTRAINT "agent_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_departments" ADD CONSTRAINT "agent_departments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_departments_department" ON "agent_departments" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "idx_agent_departments_workspace" ON "agent_departments" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_departments_one_default_per_dept" ON "agent_departments" USING btree ("department_id") WHERE "agent_departments"."is_default";
