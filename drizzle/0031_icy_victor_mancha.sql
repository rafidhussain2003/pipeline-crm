CREATE TABLE "hr_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"code" varchar(30) NOT NULL,
	"parent_id" uuid,
	"manager_user_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_designations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" varchar(120) NOT NULL,
	"code" varchar(30) NOT NULL,
	"department_id" uuid,
	"level" integer DEFAULT 5 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"title" varchar(160) NOT NULL,
	"reference" varchar(500),
	"notes" text,
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"employee_code" varchar(40) NOT NULL,
	"first_name" varchar(80) NOT NULL,
	"last_name" varchar(80),
	"preferred_name" varchar(80),
	"date_of_birth" date,
	"gender" varchar(20),
	"joining_date" date,
	"confirmation_date" date,
	"employment_status" varchar(20) DEFAULT 'active' NOT NULL,
	"department_id" uuid,
	"designation_id" uuid,
	"employment_type_id" uuid,
	"manager_user_id" uuid,
	"work_location" varchar(120),
	"emergency_contact" jsonb,
	"profile_photo_url" varchar(500),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_employment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(60) NOT NULL,
	"code" varchar(30) NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_code_prefix" varchar(12) DEFAULT 'EMP' NOT NULL,
	"next_employee_number" integer DEFAULT 1 NOT NULL,
	"default_employment_type_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hr_settings_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_parent_id_hr_departments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."hr_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_manager_user_id_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_designations" ADD CONSTRAINT "hr_designations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_designations" ADD CONSTRAINT "hr_designations_department_id_hr_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hr_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_department_id_hr_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hr_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_designation_id_hr_designations_id_fk" FOREIGN KEY ("designation_id") REFERENCES "public"."hr_designations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_employment_type_id_hr_employment_types_id_fk" FOREIGN KEY ("employment_type_id") REFERENCES "public"."hr_employment_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_manager_user_id_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employment_types" ADD CONSTRAINT "hr_employment_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_settings" ADD CONSTRAINT "hr_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_settings" ADD CONSTRAINT "hr_settings_default_employment_type_id_hr_employment_types_id_fk" FOREIGN KEY ("default_employment_type_id") REFERENCES "public"."hr_employment_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_departments_company_code_uniq" ON "hr_departments" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "hr_departments_company_idx" ON "hr_departments" USING btree ("company_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_designations_company_code_uniq" ON "hr_designations" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "hr_designations_company_idx" ON "hr_designations" USING btree ("company_id","active");--> statement-breakpoint
CREATE INDEX "hr_documents_employee_idx" ON "hr_documents" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_employees_company_user_uniq" ON "hr_employees" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_employees_company_code_uniq" ON "hr_employees" USING btree ("company_id","employee_code");--> statement-breakpoint
CREATE INDEX "hr_employees_company_status_idx" ON "hr_employees" USING btree ("company_id","employment_status");--> statement-breakpoint
CREATE INDEX "hr_employees_company_dept_idx" ON "hr_employees" USING btree ("company_id","department_id");--> statement-breakpoint
CREATE INDEX "hr_employees_manager_idx" ON "hr_employees" USING btree ("manager_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_employment_types_company_code_uniq" ON "hr_employment_types" USING btree ("company_id","code");