-- HR Record — a personnel-record-only account created when HR adds an
-- employee by email in the HR workspace. It is NOT a CRM agent: it never
-- appears in the agents roster, lead assignment, tiers, analytics, presence,
-- operations or the agent quota, and it cannot sign in to the CRM. Keeps the
-- HR workspace fully isolated from the main Ziplod.
--
-- 1) The new role value. ALTER TYPE ... ADD VALUE runs outside a transaction
--    (the reconciling boot migrator executes statements autocommit); IF NOT
--    EXISTS makes it idempotent. Purely additive.
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'hr_record';
