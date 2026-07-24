-- Facebook Form display names — initialize every EXISTING form's display name
-- to its actual form name, so agents/managers immediately see a meaningful
-- name (the copy) rather than the generic fallback, until an admin customizes
-- it. Idempotent: only fills rows that don't have one yet. Additive data
-- backfill — no schema change (agent_display_name already exists), no lead row
-- touched, no ingestion/assignment/sync logic affected.
UPDATE "lead_forms" SET "agent_display_name" = "form_name"
WHERE "agent_display_name" IS NULL AND "form_name" IS NOT NULL;
