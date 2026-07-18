CREATE TABLE "workflow_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"action_type" varchar(60) NOT NULL,
	"config" jsonb,
	"continue_on_error" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"action_type" varchar(60) NOT NULL,
	"status" varchar(20) NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"message" text,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workflow_version" integer DEFAULT 1 NOT NULL,
	"trigger_type" varchar(60) NOT NULL,
	"trigger_source" varchar(20) DEFAULT 'event' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"input" jsonb,
	"context" jsonb,
	"condition_result" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"error" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"duration_ms" integer,
	"triggered_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"default_max_retries" integer DEFAULT 3 NOT NULL,
	"default_backoff_seconds" integer DEFAULT 30 NOT NULL,
	"execution_retention_days" integer DEFAULT 90 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_settings_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_variables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"workflow_id" uuid,
	"scope" varchar(20) DEFAULT 'global' NOT NULL,
	"key" varchar(80) NOT NULL,
	"value_type" varchar(20) DEFAULT 'string' NOT NULL,
	"value" jsonb,
	"description" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"note" varchar(200),
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"trigger_type" varchar(60) NOT NULL,
	"trigger_config" jsonb,
	"conditions" jsonb,
	"retry_config" jsonb,
	"created_by" uuid,
	"updated_by" uuid,
	"last_executed_at" timestamp,
	"execution_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_execution_id_workflow_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_settings" ADD CONSTRAINT "workflow_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_variables" ADD CONSTRAINT "workflow_variables_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_variables" ADD CONSTRAINT "workflow_variables_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_actions_workflow_idx" ON "workflow_actions" USING btree ("workflow_id","position");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_execution_idx" ON "workflow_execution_logs" USING btree ("execution_id","position");--> statement-breakpoint
CREATE INDEX "workflow_executions_company_workflow_idx" ON "workflow_executions" USING btree ("company_id","workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_executions_company_status_idx" ON "workflow_executions" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "workflow_executions_retry_idx" ON "workflow_executions" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_variables_global_uniq" ON "workflow_variables" USING btree ("company_id","key") WHERE "workflow_variables"."workflow_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_variables_workflow_uniq" ON "workflow_variables" USING btree ("workflow_id","key") WHERE "workflow_variables"."workflow_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_workflow_version_uniq" ON "workflow_versions" USING btree ("workflow_id","version");--> statement-breakpoint
CREATE INDEX "workflows_company_trigger_idx" ON "workflows" USING btree ("company_id","trigger_type");--> statement-breakpoint
CREATE INDEX "workflows_company_status_idx" ON "workflows" USING btree ("company_id","status");