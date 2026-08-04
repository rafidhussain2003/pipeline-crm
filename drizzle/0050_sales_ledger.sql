-- Sales Ledger — the live spreadsheet that replaces the external Excel sheet.
-- Two additive tables; no existing table or behavior changes. IF NOT EXISTS
-- everywhere so the reconciling boot migrator is idempotent.
CREATE TABLE IF NOT EXISTS "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"sale_month" varchar(7) NOT NULL,
	"installation_date" varchar(120),
	"customer_name" varchar(200),
	"phone" varchar(60),
	"product" varchar(160),
	"autopay" boolean DEFAULT false NOT NULL,
	"activation_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_period_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"month" varchar(7) NOT NULL,
	"agent_visible_until" timestamp,
	"updated_by" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales" ADD CONSTRAINT "sales_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales" ADD CONSTRAINT "sales_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_period_settings" ADD CONSTRAINT "sales_period_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_period_settings" ADD CONSTRAINT "sales_period_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_company_month_idx" ON "sales" USING btree ("company_id","sale_month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_company_agent_month_idx" ON "sales" USING btree ("company_id","agent_id","sale_month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_company_status_idx" ON "sales" USING btree ("company_id","activation_status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_period_company_month_uniq" ON "sales_period_settings" USING btree ("company_id","month");
