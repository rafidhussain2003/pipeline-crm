-- Secure Notepad — one private, sanitized note per user. Sensitive values are
-- redacted server-side BEFORE storage (never stored anywhere); the Friday
-- cleanup removes expired placeholders. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "notepad_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"redaction_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notepad_notes" ADD CONSTRAINT "notepad_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notepad_notes" ADD CONSTRAINT "notepad_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notepad_notes_company_user_uniq" ON "notepad_notes" USING btree ("company_id","user_id");--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "notepad_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "notepad_cleanup_at" timestamp;
