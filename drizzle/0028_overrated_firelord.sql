CREATE TYPE "public"."finance_account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."finance_doc_status" AS ENUM('posted', 'voided');--> statement-breakpoint
CREATE TYPE "public"."finance_journal_status" AS ENUM('draft', 'posted', 'voided');--> statement-breakpoint
CREATE TYPE "public"."finance_year_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "finance_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" "finance_account_type" NOT NULL,
	"subtype" varchar(20),
	"parent_id" uuid,
	"is_system" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"description" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"doc_number" integer NOT NULL,
	"entry_date" date NOT NULL,
	"vendor_name" varchar(160) NOT NULL,
	"category" varchar(80),
	"payment_method" varchar(20) DEFAULT 'cash' NOT NULL,
	"receipt_ref" varchar(160),
	"expense_account_id" uuid NOT NULL,
	"payment_account_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"notes" text,
	"journal_id" uuid NOT NULL,
	"status" "finance_doc_status" DEFAULT 'posted' NOT NULL,
	"void_reason" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"line_no" integer DEFAULT 1 NOT NULL,
	"entry_date" date NOT NULL,
	"posted" boolean DEFAULT false NOT NULL,
	"debit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"description" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_number" integer,
	"entry_date" date NOT NULL,
	"memo" text,
	"status" "finance_journal_status" DEFAULT 'draft' NOT NULL,
	"source_type" varchar(30) DEFAULT 'manual' NOT NULL,
	"source_id" uuid,
	"reversal_of_id" uuid,
	"created_by" uuid,
	"posted_by" uuid,
	"posted_at" timestamp,
	"voided_by" uuid,
	"voided_at" timestamp,
	"void_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_revenues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"doc_number" integer NOT NULL,
	"entry_date" date NOT NULL,
	"customer_name" varchar(160) NOT NULL,
	"customer_ref" varchar(120),
	"invoice_ref" varchar(120),
	"income_account_id" uuid NOT NULL,
	"deposit_account_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"notes" text,
	"journal_id" uuid NOT NULL,
	"status" "finance_doc_status" DEFAULT 'posted' NOT NULL,
	"void_reason" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"next_journal_number" integer DEFAULT 1 NOT NULL,
	"next_revenue_number" integer DEFAULT 1 NOT NULL,
	"next_expense_number" integer DEFAULT 1 NOT NULL,
	"opening_balances_locked_at" timestamp,
	"default_currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "finance_settings_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE "finance_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"label" varchar(40) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "finance_year_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp,
	"closed_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_parent_id_finance_accounts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."finance_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_expenses" ADD CONSTRAINT "finance_expenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_expenses" ADD CONSTRAINT "finance_expenses_expense_account_id_finance_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_expenses" ADD CONSTRAINT "finance_expenses_payment_account_id_finance_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_expenses" ADD CONSTRAINT "finance_expenses_journal_id_finance_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."finance_journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_expenses" ADD CONSTRAINT "finance_expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_journal_lines" ADD CONSTRAINT "finance_journal_lines_journal_id_finance_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."finance_journals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_journal_lines" ADD CONSTRAINT "finance_journal_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_journal_lines" ADD CONSTRAINT "finance_journal_lines_account_id_finance_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_journals" ADD CONSTRAINT "finance_journals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_journals" ADD CONSTRAINT "finance_journals_reversal_of_id_finance_journals_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."finance_journals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_journals" ADD CONSTRAINT "finance_journals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_journals" ADD CONSTRAINT "finance_journals_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_journals" ADD CONSTRAINT "finance_journals_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_revenues" ADD CONSTRAINT "finance_revenues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_revenues" ADD CONSTRAINT "finance_revenues_income_account_id_finance_accounts_id_fk" FOREIGN KEY ("income_account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_revenues" ADD CONSTRAINT "finance_revenues_deposit_account_id_finance_accounts_id_fk" FOREIGN KEY ("deposit_account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_revenues" ADD CONSTRAINT "finance_revenues_journal_id_finance_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."finance_journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_revenues" ADD CONSTRAINT "finance_revenues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_years" ADD CONSTRAINT "finance_years_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_years" ADD CONSTRAINT "finance_years_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_accounts_company_code_uniq" ON "finance_accounts" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "finance_accounts_company_type_idx" ON "finance_accounts" USING btree ("company_id","type");--> statement-breakpoint
CREATE INDEX "finance_accounts_parent_idx" ON "finance_accounts" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_expenses_company_number_uniq" ON "finance_expenses" USING btree ("company_id","doc_number");--> statement-breakpoint
CREATE INDEX "finance_expenses_company_date_idx" ON "finance_expenses" USING btree ("company_id","entry_date");--> statement-breakpoint
CREATE INDEX "finance_ledger_account_idx" ON "finance_journal_lines" USING btree ("company_id","account_id","entry_date") WHERE posted = true;--> statement-breakpoint
CREATE INDEX "finance_journal_lines_journal_idx" ON "finance_journal_lines" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "finance_journal_lines_company_posted_idx" ON "finance_journal_lines" USING btree ("company_id","entry_date") WHERE posted = true;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_journals_company_number_uniq" ON "finance_journals" USING btree ("company_id","entry_number") WHERE entry_number is not null;--> statement-breakpoint
CREATE INDEX "finance_journals_company_status_idx" ON "finance_journals" USING btree ("company_id","status","entry_date");--> statement-breakpoint
CREATE INDEX "finance_journals_company_date_idx" ON "finance_journals" USING btree ("company_id","entry_date");--> statement-breakpoint
CREATE INDEX "finance_journals_source_idx" ON "finance_journals" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_revenues_company_number_uniq" ON "finance_revenues" USING btree ("company_id","doc_number");--> statement-breakpoint
CREATE INDEX "finance_revenues_company_date_idx" ON "finance_revenues" USING btree ("company_id","entry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_years_company_label_uniq" ON "finance_years" USING btree ("company_id","label");--> statement-breakpoint
CREATE INDEX "finance_years_company_range_idx" ON "finance_years" USING btree ("company_id","start_date","end_date");--> statement-breakpoint
ALTER TABLE "finance_journal_lines" ADD CONSTRAINT "finance_lines_nonneg_chk" CHECK (debit >= 0 AND credit >= 0);--> statement-breakpoint
ALTER TABLE "finance_journal_lines" ADD CONSTRAINT "finance_lines_one_side_chk" CHECK (NOT (debit > 0 AND credit > 0));--> statement-breakpoint
ALTER TABLE "finance_revenues" ADD CONSTRAINT "finance_revenues_amount_chk" CHECK (amount > 0);--> statement-breakpoint
ALTER TABLE "finance_expenses" ADD CONSTRAINT "finance_expenses_amount_chk" CHECK (amount > 0);
