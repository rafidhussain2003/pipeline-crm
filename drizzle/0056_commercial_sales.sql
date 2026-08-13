-- Commercial Sales — agents mark a sale "commercial" on the main ledger; the
-- sale is caught into the admin-only Commercial Sales sheet. Additive and
-- idempotent; no existing data or behavior changes.
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "is_commercial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commercial_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"add_ons" varchar(160),
	"funds_status" varchar(60),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commercial_sales" ADD CONSTRAINT "commercial_sales_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commercial_sales" ADD CONSTRAINT "commercial_sales_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commercial_sales_sale_uniq" ON "commercial_sales" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commercial_sales_company_idx" ON "commercial_sales" USING btree ("company_id","created_at");
