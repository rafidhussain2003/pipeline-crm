-- Finance Employees — a finance-only user type with a per-person capability set.
--
-- 1) A new value on the existing "role" enum. ALTER TYPE ... ADD VALUE runs
--    outside a transaction (the reconciling boot migrator executes statements
--    autocommit, so this is safe); IF NOT EXISTS makes it idempotent and the
--    migrator tolerates duplicate_object. Purely additive.
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'finance_employee';--> statement-breakpoint
-- 2) Per-user finance capability set (object of booleans). NULL = none.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "finance_capabilities" jsonb;--> statement-breakpoint
-- 3) The money-out document kind, so "expense" vs "customer payout" vs "salary"
--    can be gated independently. Existing rows default to "expense".
ALTER TABLE "finance_expenses" ADD COLUMN IF NOT EXISTS "doc_type" varchar(20) DEFAULT 'expense' NOT NULL;
