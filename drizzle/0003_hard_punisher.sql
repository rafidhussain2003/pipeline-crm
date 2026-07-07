ALTER TABLE "companies" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "website" varchar(255);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "timezone" varchar(100);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "support_email" varchar(255);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "business_phone" varchar(50);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sms_notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp;