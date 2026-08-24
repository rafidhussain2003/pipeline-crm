-- My Excel — a personal spreadsheet workspace per user (separate from the Sales
-- Ledger). One workbook per (company, user); sheets store cells + dimensions as
-- compact jsonb. Strictly company + user scoped. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "excel_workbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "excel_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workbook_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) DEFAULT 'Sheet1' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"cells" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_heights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"col_widths" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" integer DEFAULT 100 NOT NULL,
	"col_count" integer DEFAULT 26 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "excel_workbooks" ADD CONSTRAINT "excel_workbooks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "excel_workbooks" ADD CONSTRAINT "excel_workbooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "excel_sheets" ADD CONSTRAINT "excel_sheets_workbook_id_excel_workbooks_id_fk" FOREIGN KEY ("workbook_id") REFERENCES "public"."excel_workbooks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "excel_sheets" ADD CONSTRAINT "excel_sheets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "excel_sheets" ADD CONSTRAINT "excel_sheets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "excel_workbooks_company_user_uniq" ON "excel_workbooks" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "excel_sheets_workbook_idx" ON "excel_sheets" USING btree ("workbook_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "excel_sheets_owner_idx" ON "excel_sheets" USING btree ("company_id","user_id");
