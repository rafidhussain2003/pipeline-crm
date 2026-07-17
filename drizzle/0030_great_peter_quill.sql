CREATE TABLE "payroll_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(12) NOT NULL,
	"category" varchar(20) NOT NULL,
	"label" varchar(120) NOT NULL,
	"amount_cents" bigint NOT NULL,
	"recurring" boolean DEFAULT false NOT NULL,
	"effective_date" date NOT NULL,
	"end_date" date,
	"applied_run_id" uuid,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"structure_id" uuid,
	"basic_cents" bigint DEFAULT 0 NOT NULL,
	"allowances_cents" bigint DEFAULT 0 NOT NULL,
	"incentives_cents" bigint DEFAULT 0 NOT NULL,
	"overtime_cents" bigint DEFAULT 0 NOT NULL,
	"gross_cents" bigint DEFAULT 0 NOT NULL,
	"deductions_cents" bigint DEFAULT 0 NOT NULL,
	"leave_adjustment_cents" bigint DEFAULT 0 NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"net_cents" bigint DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"attendance" jsonb,
	"breakdown" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"structure_id" uuid,
	"frequency" varchar(12) DEFAULT 'monthly' NOT NULL,
	"joining_date" date,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"bank_account_ref" varchar(120),
	"tax_ref" varchar(120),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_number" integer,
	"label" varchar(120) NOT NULL,
	"frequency" varchar(12) DEFAULT 'monthly' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"pay_date" date NOT NULL,
	"status" varchar(12) DEFAULT 'draft' NOT NULL,
	"total_gross_cents" bigint DEFAULT 0 NOT NULL,
	"total_deductions_cents" bigint DEFAULT 0 NOT NULL,
	"total_net_cents" bigint DEFAULT 0 NOT NULL,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"accrual_journal_id" uuid,
	"payment_journal_id" uuid,
	"payment_account_code" varchar(20),
	"calculated_at" timestamp,
	"approved_by" uuid,
	"approved_at" timestamp,
	"locked_at" timestamp,
	"paid_by" uuid,
	"paid_at" timestamp,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"default_frequency" varchar(12) DEFAULT 'monthly' NOT NULL,
	"overtime_multiplier" real DEFAULT 1.5 NOT NULL,
	"standard_workday_minutes" integer DEFAULT 480 NOT NULL,
	"standard_workdays_per_month" integer DEFAULT 22 NOT NULL,
	"pay_day_of_month" integer DEFAULT 1 NOT NULL,
	"salary_expense_account_code" varchar(20) DEFAULT '5200' NOT NULL,
	"salary_payable_account_code" varchar(20) DEFAULT '2200' NOT NULL,
	"default_payment_account_code" varchar(20) DEFAULT '1100' NOT NULL,
	"next_run_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_settings_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE "payroll_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"root_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"name" varchar(120) NOT NULL,
	"frequency" varchar(12) DEFAULT 'monthly' NOT NULL,
	"basic_cents" bigint DEFAULT 0 NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_structure_id_payroll_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."payroll_structures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_profiles" ADD CONSTRAINT "payroll_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_profiles" ADD CONSTRAINT "payroll_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_profiles" ADD CONSTRAINT "payroll_profiles_structure_id_payroll_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."payroll_structures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_structures" ADD CONSTRAINT "payroll_structures_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_structures" ADD CONSTRAINT "payroll_structures_root_id_payroll_structures_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."payroll_structures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_structures" ADD CONSTRAINT "payroll_structures_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_adjustments_company_user_idx" ON "payroll_adjustments" USING btree ("company_id","user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_items_run_user_uniq" ON "payroll_items" USING btree ("run_id","user_id");--> statement-breakpoint
CREATE INDEX "payroll_items_company_user_idx" ON "payroll_items" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "payroll_items_run_idx" ON "payroll_items" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_profiles_company_user_uniq" ON "payroll_profiles" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_company_number_uniq" ON "payroll_runs" USING btree ("company_id","run_number") WHERE run_number is not null;--> statement-breakpoint
CREATE INDEX "payroll_runs_company_status_idx" ON "payroll_runs" USING btree ("company_id","status","period_start");--> statement-breakpoint
CREATE INDEX "payroll_structures_company_idx" ON "payroll_structures" USING btree ("company_id","active");--> statement-breakpoint
CREATE INDEX "payroll_structures_root_idx" ON "payroll_structures" USING btree ("root_id");