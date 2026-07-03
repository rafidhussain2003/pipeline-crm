CREATE TYPE "public"."assignment_mode" AS ENUM('round_robin', 'weighted', 'skill_based');--> statement-breakpoint
CREATE TYPE "public"."company_status" AS ENUM('pending', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('super_admin', 'admin', 'agent');--> statement-breakpoint
CREATE TYPE "public"."source_platform" AS ENUM('facebook', 'google', 'generic', 'reddit', 'other');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('1', '2', '3');--> statement-breakpoint
CREATE TYPE "public"."webhook_log_status" AS ENUM('success', 'failed', 'retried');--> statement-breakpoint
CREATE TABLE "assignment_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"assigned_to" uuid,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"rule_used" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "assignment_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"tier" "tier" NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"user_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"auto_assign_enabled" boolean DEFAULT true NOT NULL,
	"assignment_mode" "assignment_mode" DEFAULT 'weighted' NOT NULL,
	"auto_recycle_enabled" boolean DEFAULT false NOT NULL,
	"recycle_after_minutes" integer DEFAULT 1440 NOT NULL,
	CONSTRAINT "automation_settings_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"status" "company_status" DEFAULT 'pending' NOT NULL,
	"plan" varchar(100) DEFAULT 'starter' NOT NULL,
	"price_per_agent_cents" integer DEFAULT 1900 NOT NULL,
	"custom_domain" varchar(255),
	"custom_domain_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "disposition_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"label" varchar(100) NOT NULL,
	"color" varchar(20) DEFAULT '#2563eb' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer,
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"platform" "source_platform" DEFAULT 'facebook' NOT NULL,
	"page_id" varchar(255),
	"page_name" varchar(255),
	"access_token" text,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"webhook_secret" text,
	"field_mapping" jsonb,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "lead_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_id" uuid,
	"name" varchar(255),
	"phone" varchar(50),
	"email" varchar(255),
	"state" varchar(100),
	"disposition" varchar(100) DEFAULT 'New Lead' NOT NULL,
	"owner_id" uuid,
	"required_skill_id" uuid,
	"follow_up_at" timestamp,
	"raw_payload" jsonb,
	"is_duplicate" boolean DEFAULT false NOT NULL,
	"duplicate_of_lead_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_agent" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "saved_filters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"filter_json" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"label" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"label" varchar(100) NOT NULL,
	"color" varchar(20) DEFAULT '#64748b' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'agent' NOT NULL,
	"tier" "tier" DEFAULT '1',
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"company_id" uuid,
	"status" "webhook_log_status" NOT NULL,
	"payload" jsonb,
	"error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_log" ADD CONSTRAINT "assignment_log_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_log" ADD CONSTRAINT "assignment_log_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_rules" ADD CONSTRAINT "assignment_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_settings" ADD CONSTRAINT "automation_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposition_options" ADD CONSTRAINT "disposition_options_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_attachments" ADD CONSTRAINT "lead_attachments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_attachments" ADD CONSTRAINT "lead_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_required_skill_id_skills_id_fk" FOREIGN KEY ("required_skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_rules_company_idx" ON "assignment_rules" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "audit_log_company_idx" ON "audit_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "disposition_company_idx" ON "disposition_options" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "lead_attachments_lead_idx" ON "lead_attachments" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_notes_lead_idx" ON "lead_notes" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_sources_company_idx" ON "lead_sources" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_tags_unique" ON "lead_tags" USING btree ("lead_id","tag_id");--> statement-breakpoint
CREATE INDEX "leads_company_idx" ON "leads" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "leads_owner_idx" ON "leads" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "leads_created_idx" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("company_id","phone");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("company_id","email");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_filters_company_idx" ON "saved_filters" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "saved_filters_user_idx" ON "saved_filters" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "skills_company_idx" ON "skills" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "tags_company_idx" ON "tags" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_skills_unique" ON "user_skills" USING btree ("user_id","skill_id");--> statement-breakpoint
CREATE INDEX "users_company_idx" ON "users" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "webhook_logs_source_idx" ON "webhook_logs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "webhook_logs_company_idx" ON "webhook_logs" USING btree ("company_id");