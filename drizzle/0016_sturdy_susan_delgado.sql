CREATE TYPE "public"."assignment_job_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."assignment_outcome" AS ENUM('assigned', 'no_eligible_agent', 'claim_lost', 'skipped', 'error');--> statement-breakpoint
CREATE TABLE "assignment_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"assigned_to" uuid,
	"outcome" "assignment_outcome" NOT NULL,
	"strategy_used" varchar(50),
	"candidate_ids" jsonb,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"presence_status" varchar(20),
	"processing_time_ms" integer,
	"attempt" integer DEFAULT 1 NOT NULL,
	"source" varchar(20),
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"status" "assignment_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 10 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"locked_at" timestamp,
	"locked_by" varchar(100),
	"required_skill_id" uuid,
	"exclude_agent_id" uuid,
	"source" varchar(20) DEFAULT 'arrival' NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_jobs" ADD CONSTRAINT "assignment_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_jobs" ADD CONSTRAINT "assignment_jobs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_history_company_created_idx" ON "assignment_history" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "assignment_history_lead_idx" ON "assignment_history" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "assignment_history_assigned_to_idx" ON "assignment_history" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "assignment_jobs_due_idx" ON "assignment_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "assignment_jobs_company_idx" ON "assignment_jobs" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_jobs_lead_active_uniq" ON "assignment_jobs" USING btree ("lead_id") WHERE status in ('pending','processing','failed');