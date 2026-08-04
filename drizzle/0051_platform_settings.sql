-- Platform Settings — a tiny GLOBAL key/value store for platform-owner knobs
-- (first use: the agent lead-visibility cap). Additive; no existing table or
-- behavior changes. IF NOT EXISTS / duplicate-object guards keep the
-- reconciling boot migrator idempotent.
CREATE TABLE IF NOT EXISTS "platform_settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
