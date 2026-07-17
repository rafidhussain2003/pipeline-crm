CREATE TABLE "attendance_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"shift_id" uuid,
	"effective_from" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp,
	"duration_minutes" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"date" date NOT NULL,
	"kind" varchar(20) DEFAULT 'company' NOT NULL,
	"recurring" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"review_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"record_id" uuid,
	"action" varchar(30) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"shift_id" uuid,
	"check_in_at" timestamp NOT NULL,
	"check_out_at" timestamp,
	"check_in_timezone" varchar(64),
	"check_in_ip" varchar(64),
	"check_in_user_agent" varchar(255),
	"check_in_location" jsonb,
	"check_in_device" varchar(80),
	"late_status" varchar(16),
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"departure_status" varchar(16),
	"early_minutes" integer DEFAULT 0 NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"worked_minutes" integer,
	"manual_adjusted" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"default_shift_id" uuid,
	"weekend_days" jsonb DEFAULT '[0,6]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_settings_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE "attendance_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"start_minute" integer DEFAULT 540 NOT NULL,
	"end_minute" integer DEFAULT 1020 NOT NULL,
	"grace_minutes" integer DEFAULT 10 NOT NULL,
	"very_late_minutes" integer DEFAULT 30 NOT NULL,
	"early_leave_minutes" integer DEFAULT 15 NOT NULL,
	"flexible" boolean DEFAULT false NOT NULL,
	"timezone" varchar(64),
	"is_system" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_assignments" ADD CONSTRAINT "attendance_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_assignments" ADD CONSTRAINT "attendance_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_assignments" ADD CONSTRAINT "attendance_assignments_shift_id_attendance_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."attendance_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_breaks" ADD CONSTRAINT "attendance_breaks_record_id_attendance_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."attendance_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_breaks" ADD CONSTRAINT "attendance_breaks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_holidays" ADD CONSTRAINT "attendance_holidays_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_leave_requests" ADD CONSTRAINT "attendance_leave_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_leave_requests" ADD CONSTRAINT "attendance_leave_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_leave_requests" ADD CONSTRAINT "attendance_leave_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_record_id_attendance_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."attendance_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_shift_id_attendance_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."attendance_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD CONSTRAINT "attendance_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD CONSTRAINT "attendance_settings_default_shift_id_attendance_shifts_id_fk" FOREIGN KEY ("default_shift_id") REFERENCES "public"."attendance_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_shifts" ADD CONSTRAINT "attendance_shifts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_assignments_company_user_uniq" ON "attendance_assignments" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "attendance_breaks_record_idx" ON "attendance_breaks" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "attendance_holidays_company_date_idx" ON "attendance_holidays" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "attendance_leaves_company_status_idx" ON "attendance_leave_requests" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "attendance_leaves_user_range_idx" ON "attendance_leave_requests" USING btree ("user_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "attendance_logs_company_created_idx" ON "attendance_logs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "attendance_logs_user_created_idx" ON "attendance_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_records_company_user_date_uniq" ON "attendance_records" USING btree ("company_id","user_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_records_company_date_idx" ON "attendance_records" USING btree ("company_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_records_user_date_idx" ON "attendance_records" USING btree ("user_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_shifts_company_idx" ON "attendance_shifts" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_shifts_company_name_uniq" ON "attendance_shifts" USING btree ("company_id","name");