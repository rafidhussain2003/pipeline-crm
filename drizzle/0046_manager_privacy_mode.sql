-- Manager Privacy Mode — a per-company toggle (default ON) controlling whether
-- the Lead Distribution Manager role sees customer PII. Additive column with a
-- safe default; existing companies get privacy ON (the secure default), so no
-- behavior changes until an admin turns it off.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "manager_privacy_mode" boolean DEFAULT true NOT NULL;
