-- Commercial Sales: one-way pull from the main ledger (main → Commercial,
-- never back). admin_overrides lists the fields the admin has edited on the
-- Commercial sheet; the pull skips those so an admin's edit here is never
-- overwritten, while untouched fields keep following the sale. Additive +
-- idempotent.
ALTER TABLE "commercial_sales" ADD COLUMN IF NOT EXISTS "admin_overrides" jsonb;
