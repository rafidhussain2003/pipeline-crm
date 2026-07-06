CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'sms', 'webhook', 'push');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."presence_status" AS ENUM('online', 'idle', 'busy', 'break', 'offline');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"scopes" jsonb NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "notification_channel" DEFAULT 'in_app' NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"type" varchar(100) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"metadata" jsonb,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "audit_log_company_idx";--> statement-breakpoint
DROP INDEX "leads_company_idx";--> statement-breakpoint
DROP INDEX "leads_owner_idx";--> statement-breakpoint
ALTER TABLE "automation_settings" ADD COLUMN "heartbeat_timeout_seconds" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_settings" ADD COLUMN "working_hours_start" integer;--> statement-breakpoint
ALTER TABLE "automation_settings" ADD COLUMN "working_hours_end" integer;--> statement-breakpoint
ALTER TABLE "automation_settings" ADD COLUMN "max_open_leads_per_agent" integer;--> statement-breakpoint
ALTER TABLE "automation_settings" ADD COLUMN "max_recycle_count" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_settings" ADD COLUMN "assignment_cursor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "recycle_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "priority" varchar(20) DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "is_blacklisted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "presence_status" "presence_status" DEFAULT 'offline' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_heartbeat_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_company_idx" ON "api_keys" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_company_idx" ON "notifications" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "audit_log_company_created_idx" ON "audit_log" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_company_owner_idx" ON "leads" USING btree ("company_id","owner_id");--> statement-breakpoint
CREATE INDEX "leads_disposition_idx" ON "leads" USING btree ("company_id","disposition");--> statement-breakpoint
CREATE INDEX "leads_priority_idx" ON "leads" USING btree ("company_id","priority");