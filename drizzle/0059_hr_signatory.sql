-- HR — company HR signatory (name/title) printed on generated Offer Letters
-- and Employment & Data Protection Agreements. Additive + idempotent.
ALTER TABLE "hr_settings" ADD COLUMN IF NOT EXISTS "hr_signatory_name" varchar(100);--> statement-breakpoint
ALTER TABLE "hr_settings" ADD COLUMN IF NOT EXISTS "hr_signatory_title" varchar(100);
