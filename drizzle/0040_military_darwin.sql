CREATE TABLE "finance_investments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"category" varchar(80),
	"purchase_date" date NOT NULL,
	"purchase_value" numeric(14, 2) NOT NULL,
	"current_value" numeric(14, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"withdrawn_value" numeric(14, 2),
	"withdrawn_at" timestamp,
	"payment_account_id" uuid,
	"journal_id" uuid,
	"withdrawal_journal_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "monthly_salary" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "module_access" jsonb;--> statement-breakpoint
ALTER TABLE "finance_investments" ADD CONSTRAINT "finance_investments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_investments" ADD CONSTRAINT "finance_investments_payment_account_id_finance_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_investments" ADD CONSTRAINT "finance_investments_journal_id_finance_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."finance_journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_investments" ADD CONSTRAINT "finance_investments_withdrawal_journal_id_finance_journals_id_fk" FOREIGN KEY ("withdrawal_journal_id") REFERENCES "public"."finance_journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_investments" ADD CONSTRAINT "finance_investments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_investments_company_idx" ON "finance_investments" USING btree ("company_id","status");