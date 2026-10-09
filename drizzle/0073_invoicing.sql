-- Invoicing: billing clients (the "Bill To" party), the seller invoice
-- profile + INV/<FY>/<NNN> counter on finance_settings, and the invoice
-- fields on finance_revenues. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "finance_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"address_line1" varchar(200) NOT NULL,
	"address_line2" varchar(200),
	"city" varchar(120) NOT NULL,
	"state" varchar(120),
	"postal_code" varchar(32),
	"country" varchar(120) NOT NULL,
	"email" varchar(200),
	"phone" varchar(60),
	"gstin" varchar(32),
	"invoice_currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"service_description" varchar(200) DEFAULT 'BPO Services' NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_revenues" ADD COLUMN IF NOT EXISTS "client_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_revenues" ADD COLUMN IF NOT EXISTS "invoice_number" varchar(40);--> statement-breakpoint
ALTER TABLE "finance_revenues" ADD COLUMN IF NOT EXISTS "invoice_date" date;--> statement-breakpoint
ALTER TABLE "finance_revenues" ADD COLUMN IF NOT EXISTS "service_period" varchar(60);--> statement-breakpoint
ALTER TABLE "finance_revenues" ADD COLUMN IF NOT EXISTS "service_description" varchar(200);--> statement-breakpoint
ALTER TABLE "finance_revenues" ADD COLUMN IF NOT EXISTS "invoice_currency" varchar(3);--> statement-breakpoint
ALTER TABLE "finance_revenues" ADD COLUMN IF NOT EXISTS "invoice_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "finance_settings" ADD COLUMN IF NOT EXISTS "invoice_legal_name" varchar(200);--> statement-breakpoint
ALTER TABLE "finance_settings" ADD COLUMN IF NOT EXISTS "invoice_address" text;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD COLUMN IF NOT EXISTS "invoice_gstin" varchar(32);--> statement-breakpoint
ALTER TABLE "finance_settings" ADD COLUMN IF NOT EXISTS "invoice_lut_note" text;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD COLUMN IF NOT EXISTS "invoice_signatory_name" varchar(120);--> statement-breakpoint
ALTER TABLE "finance_settings" ADD COLUMN IF NOT EXISTS "invoice_signatory_title" varchar(120);--> statement-breakpoint
ALTER TABLE "finance_settings" ADD COLUMN IF NOT EXISTS "invoice_number_prefix" varchar(16) DEFAULT 'INV' NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD COLUMN IF NOT EXISTS "invoice_number_fy" varchar(9);--> statement-breakpoint
ALTER TABLE "finance_settings" ADD COLUMN IF NOT EXISTS "next_invoice_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance_clients" ADD CONSTRAINT "finance_clients_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance_clients" ADD CONSTRAINT "finance_clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_clients_company_idx" ON "finance_clients" USING btree ("company_id","name");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance_revenues" ADD CONSTRAINT "finance_revenues_client_id_finance_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."finance_clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "finance_revenues_company_invoice_uniq" ON "finance_revenues" USING btree ("company_id","invoice_number");