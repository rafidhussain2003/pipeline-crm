-- Agent lead-visibility limit becomes a PER-COMPANY, admin-controlled setting
-- (it was briefly a global platform setting in 0051). Add the nullable column
-- on companies (NULL = built-in default) and drop the now-unused global table.
-- Idempotent and order-safe: if 0051 already created platform_settings it is
-- dropped here; if 0051 and this run apply together, the create-then-drop
-- still converges to "column present, global table gone".
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "agent_lead_visibility_limit" integer;--> statement-breakpoint
DROP TABLE IF EXISTS "platform_settings";
