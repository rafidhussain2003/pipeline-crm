CREATE TYPE "public"."lead_source_status" AS ENUM('connected', 'token_expired', 'error', 'disconnected');--> statement-breakpoint
CREATE TABLE "lead_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"form_id" varchar(255) NOT NULL,
	"form_name" varchar(255),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The old "status" column was free-form text that had, as of this
-- migration, only ever been set to "active" anywhere in the codebase.
-- Remap it to the new enum's equivalent value BEFORE the type change below,
-- so this migration doesn't fail with "invalid input value for enum" if it
-- ever runs against a database that has rows the direct cast can't handle
-- (verified empty in production right now, but this makes the migration
-- correct regardless of what's actually in the table when it runs).
UPDATE "lead_sources" SET "status" = 'connected' WHERE "status" NOT IN ('connected', 'token_expired', 'error', 'disconnected');--> statement-breakpoint
ALTER TABLE "lead_sources" ALTER COLUMN "status" SET DEFAULT 'connected'::"public"."lead_source_status";--> statement-breakpoint
ALTER TABLE "lead_sources" ALTER COLUMN "status" SET DATA TYPE "public"."lead_source_status" USING "status"::"public"."lead_source_status";--> statement-breakpoint
ALTER TABLE "lead_sources" ADD COLUMN "business_id" varchar(255);--> statement-breakpoint
ALTER TABLE "lead_sources" ADD COLUMN "business_name" varchar(255);--> statement-breakpoint
ALTER TABLE "lead_sources" ADD COLUMN "token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_forms_source_idx" ON "lead_forms" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_forms_source_form_unique" ON "lead_forms" USING btree ("source_id","form_id");--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;