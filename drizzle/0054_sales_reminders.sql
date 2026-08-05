-- Sales Ledger V2 — installation reminders. Adds the derived installation_at
-- timestamp to sales (+ its dashboard index) and the sales_reminders table.
-- Additive and idempotent; no existing data or behavior changes.
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "installation_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_company_installation_idx" ON "sales" USING btree ("company_id","installation_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"due_at" timestamp NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"notified_at" timestamp,
	"completed_at" timestamp,
	"completed_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_reminders" ADD CONSTRAINT "sales_reminders_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_reminders" ADD CONSTRAINT "sales_reminders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_reminders" ADD CONSTRAINT "sales_reminders_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_reminders" ADD CONSTRAINT "sales_reminders_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_reminders_company_agent_due_idx" ON "sales_reminders" USING btree ("company_id","agent_id","due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_reminders_status_due_idx" ON "sales_reminders" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_reminders_sale_idx" ON "sales_reminders" USING btree ("sale_id");
