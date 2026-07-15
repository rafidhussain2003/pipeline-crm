CREATE TYPE "public"."agent_override_type" AS ENUM('pause', 'lock', 'reserve', 'force', 'capacity_boost');--> statement-breakpoint
ALTER TYPE "public"."tier" ADD VALUE 'senior';--> statement-breakpoint
ALTER TYPE "public"."tier" ADD VALUE 'supervisor';--> statement-breakpoint
CREATE TABLE "agent_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid,
	"type" "agent_override_type" NOT NULL,
	"value" jsonb,
	"expires_at" timestamp NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_jobs" ADD COLUMN "sla_deadline" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "skill_requirements" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "routing_config" jsonb;--> statement-breakpoint
ALTER TABLE "agent_overrides" ADD CONSTRAINT "agent_overrides_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_overrides" ADD CONSTRAINT "agent_overrides_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_overrides" ADD CONSTRAINT "agent_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_overrides_company_active_idx" ON "agent_overrides" USING btree ("company_id","expires_at");--> statement-breakpoint
CREATE INDEX "agent_overrides_agent_idx" ON "agent_overrides" USING btree ("agent_id");