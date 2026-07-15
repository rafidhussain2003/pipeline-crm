CREATE TYPE "public"."lifecycle_stage" AS ENUM('new', 'queued', 'assigned', 'contacted', 'in_progress', 'follow_up', 'won', 'lost', 'closed');--> statement-breakpoint
CREATE TABLE "lead_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_stage" varchar(20),
	"to_stage" "lifecycle_stage" NOT NULL,
	"reason" varchar(100),
	"actor_user_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_jobs" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_settings" ADD COLUMN "queue_config" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lifecycle_stage" "lifecycle_stage" DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "assigned_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead_lifecycle_events" ADD CONSTRAINT "lead_lifecycle_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_lifecycle_events" ADD CONSTRAINT "lead_lifecycle_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_lifecycle_events" ADD CONSTRAINT "lead_lifecycle_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_lifecycle_events_lead_idx" ON "lead_lifecycle_events" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_lifecycle_events_company_created_idx" ON "lead_lifecycle_events" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_lifecycle_events_to_stage_idx" ON "lead_lifecycle_events" USING btree ("company_id","to_stage");--> statement-breakpoint
CREATE INDEX "assignment_jobs_priority_due_idx" ON "assignment_jobs" USING btree ("status","priority","available_at");--> statement-breakpoint
UPDATE "leads" SET "lifecycle_stage" = 'assigned', "assigned_at" = COALESCE("updated_at", now()) WHERE "owner_id" IS NOT NULL AND "lifecycle_stage" = 'new' AND "deleted_at" IS NULL;