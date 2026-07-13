CREATE TYPE "public"."lead_import_log_status" AS ENUM('imported', 'duplicate', 'failed');--> statement-breakpoint
CREATE TYPE "public"."lead_import_range" AS ENUM('7d', '30d', '90d', '180d', '365d', 'all');--> statement-breakpoint
CREATE TYPE "public"."lead_import_status" AS ENUM('running', 'paused', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "lead_import_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"leadgen_id" varchar(255) NOT NULL,
	"form_id" varchar(255),
	"status" "lead_import_log_status" NOT NULL,
	"lead_id" uuid,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "lead_import_status" DEFAULT 'running' NOT NULL,
	"range" "lead_import_range" NOT NULL,
	"form_ids" jsonb NOT NULL,
	"checkpoint" jsonb NOT NULL,
	"total_found" integer DEFAULT 0 NOT NULL,
	"total_imported" integer DEFAULT 0 NOT NULL,
	"total_skipped" integer DEFAULT 0 NOT NULL,
	"total_failed" integer DEFAULT 0 NOT NULL,
	"current_form_id" varchar(255),
	"current_form_name" varchar(255),
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"last_processed_at" timestamp DEFAULT now() NOT NULL,
	"error" text,
	"created_by" uuid,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "lead_import_logs" ADD CONSTRAINT "lead_import_logs_import_id_lead_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."lead_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_import_logs" ADD CONSTRAINT "lead_import_logs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_imports" ADD CONSTRAINT "lead_imports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_imports" ADD CONSTRAINT "lead_imports_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_imports" ADD CONSTRAINT "lead_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_import_logs_import_idx" ON "lead_import_logs" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "lead_imports_source_idx" ON "lead_imports" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "lead_imports_company_idx" ON "lead_imports" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "lead_imports_status_heartbeat_idx" ON "lead_imports" USING btree ("status","last_processed_at");