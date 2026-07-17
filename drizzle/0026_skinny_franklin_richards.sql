CREATE TABLE "progressive_release_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"wave_started_at" timestamp,
	"initial_backlog" integer DEFAULT 0 NOT NULL,
	"released_count" integer DEFAULT 0 NOT NULL,
	"last_cycle_at" timestamp,
	"next_release_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "progressive_release_state_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
ALTER TABLE "automation_settings" ADD COLUMN "progressive_config" jsonb;--> statement-breakpoint
ALTER TABLE "progressive_release_state" ADD CONSTRAINT "progressive_release_state_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;