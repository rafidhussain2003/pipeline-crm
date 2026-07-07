CREATE TYPE "public"."subscription_status" AS ENUM('trial', 'active', 'past_due', 'cancelled');--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "subscription_status" "subscription_status" DEFAULT 'trial' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "trial_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "trial_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "current_period_end" timestamp;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "stripe_customer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "stripe_subscription_id" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX "companies_stripe_customer_idx" ON "companies" USING btree ("stripe_customer_id");--> statement-breakpoint
-- Backfill for companies that existed before this migration: everything
-- above defaults new rows to subscription_status='trial', which would
-- incorrectly mark already-approved, already-paying (manual-billing-phase)
-- companies as being on an expired trial and lock them out the moment the
-- new trial-gate goes live. Grandfather them in instead:
--   - status='active' (already approved/using the product) -> subscription
--     treated as 'active' with no trial window, so the new gate never
--     blocks them. They can still be moved onto real Stripe billing later
--     via the Subscription page.
--   - status='pending'/'suspended' -> gets a real trial window computed
--     from their original signup date (created_at), same as if they'd
--     signed up today, rather than an untraceable synthetic date.
UPDATE "companies" SET
  "subscription_status" = 'active',
  "trial_started_at" = "created_at",
  "trial_ends_at" = "created_at" + interval '7 days'
WHERE "status" = 'active';--> statement-breakpoint
UPDATE "companies" SET
  "subscription_status" = 'trial',
  "trial_started_at" = "created_at",
  "trial_ends_at" = "created_at" + interval '7 days'
WHERE "status" IN ('pending', 'suspended');