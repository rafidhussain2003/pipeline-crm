-- Smart Assignment Cooldown. Two additive columns with safe defaults:
--   • automation_settings.assignment_cooldown_seconds — how long an agent sits
--     out after an automatic assignment (default 300s = 5 min).
--   • users.last_auto_assigned_at — when the agent last received an automatic
--     lead (nullable; stamped by the assignment pipeline only).
-- No existing row or behavior changes on apply beyond the new default cooldown.
ALTER TABLE "automation_settings" ADD COLUMN IF NOT EXISTS "assignment_cooldown_seconds" integer DEFAULT 300 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_auto_assigned_at" timestamp;
