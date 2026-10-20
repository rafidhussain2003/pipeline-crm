-- Lending Bank — admin-only private lending ledger (INR, paise). Additive + idempotent.
DO $$ BEGIN
 CREATE TYPE "public"."lending_emi_status" AS ENUM('pending', 'paid');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."lending_loan_status" AS ENUM('active', 'closed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lending_banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"default_interest_rate" numeric(5, 2) DEFAULT '14.00' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lending_banks_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lending_emis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"installment_no" integer NOT NULL,
	"due_date" date NOT NULL,
	"emi_cents" bigint NOT NULL,
	"principal_cents" bigint NOT NULL,
	"interest_cents" bigint NOT NULL,
	"balance_after_cents" bigint NOT NULL,
	"status" "lending_emi_status" DEFAULT 'pending' NOT NULL,
	"paid_on" date,
	"paid_cents" bigint,
	"paid_note" varchar(200),
	"reminder_sent_at" timestamp,
	"due_notice_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lending_loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"loan_number" integer NOT NULL,
	"borrower_name" varchar(160) NOT NULL,
	"borrower_phone" varchar(40) NOT NULL,
	"borrower_email" varchar(200) NOT NULL,
	"principal_cents" bigint NOT NULL,
	"interest_rate" numeric(5, 2) NOT NULL,
	"tenure_months" integer NOT NULL,
	"emi_cents" bigint NOT NULL,
	"total_interest_cents" bigint NOT NULL,
	"total_payable_cents" bigint NOT NULL,
	"start_date" date NOT NULL,
	"first_due_date" date NOT NULL,
	"status" "lending_loan_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"last_email_at" timestamp,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lending_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"amount_cents" bigint NOT NULL,
	"loan_id" uuid,
	"emi_id" uuid,
	"note" varchar(300),
	"occurred_on" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lending_banks" ADD CONSTRAINT "lending_banks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lending_banks" ADD CONSTRAINT "lending_banks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lending_emis" ADD CONSTRAINT "lending_emis_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lending_emis" ADD CONSTRAINT "lending_emis_loan_id_lending_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."lending_loans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lending_loans" ADD CONSTRAINT "lending_loans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lending_loans" ADD CONSTRAINT "lending_loans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lending_transactions" ADD CONSTRAINT "lending_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lending_transactions" ADD CONSTRAINT "lending_transactions_loan_id_lending_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."lending_loans"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lending_transactions" ADD CONSTRAINT "lending_transactions_emi_id_lending_emis_id_fk" FOREIGN KEY ("emi_id") REFERENCES "public"."lending_emis"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lending_transactions" ADD CONSTRAINT "lending_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lending_emis_loan_installment_uniq" ON "lending_emis" USING btree ("loan_id","installment_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lending_emis_company_due_idx" ON "lending_emis" USING btree ("company_id","status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lending_loans_company_number_uniq" ON "lending_loans" USING btree ("company_id","loan_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lending_loans_company_status_idx" ON "lending_loans" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lending_transactions_company_idx" ON "lending_transactions" USING btree ("company_id","occurred_on");