ALTER TYPE "public"."source_platform" ADD VALUE 'google_ads' BEFORE 'generic';--> statement-breakpoint
ALTER TYPE "public"."source_platform" ADD VALUE 'tiktok' BEFORE 'generic';--> statement-breakpoint
ALTER TYPE "public"."source_platform" ADD VALUE 'linkedin' BEFORE 'generic';--> statement-breakpoint
ALTER TYPE "public"."source_platform" ADD VALUE 'microsoft' BEFORE 'generic';--> statement-breakpoint
ALTER TYPE "public"."source_platform" ADD VALUE 'typeform' BEFORE 'reddit';--> statement-breakpoint
ALTER TYPE "public"."source_platform" ADD VALUE 'gravityforms' BEFORE 'reddit';--> statement-breakpoint
ALTER TYPE "public"."source_platform" ADD VALUE 'jotform' BEFORE 'reddit';--> statement-breakpoint
ALTER TYPE "public"."source_platform" ADD VALUE 'wordpress' BEFORE 'reddit';--> statement-breakpoint
ALTER TYPE "public"."source_platform" ADD VALUE 'gohighlevel' BEFORE 'reddit';--> statement-breakpoint
ALTER TYPE "public"."source_platform" ADD VALUE 'zapier' BEFORE 'reddit';--> statement-breakpoint
ALTER TYPE "public"."source_platform" ADD VALUE 'make' BEFORE 'reddit';--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "provider_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD COLUMN "refresh_token" text;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD COLUMN "provider_metadata" jsonb;