CREATE TYPE "public"."webhook_status" AS ENUM('active', 'inactive');--> statement-breakpoint
ALTER TYPE "public"."lead_source_status" ADD VALUE 'permission_revoked' BEFORE 'error';--> statement-breakpoint
ALTER TYPE "public"."lead_source_status" ADD VALUE 'not_found' BEFORE 'error';--> statement-breakpoint
ALTER TABLE "lead_sources" ADD COLUMN "webhook_status" "webhook_status" DEFAULT 'active' NOT NULL;