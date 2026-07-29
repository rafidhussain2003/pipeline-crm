-- Lead Distribution Manager — a new value on the existing "role" enum.
-- ALTER TYPE ... ADD VALUE runs outside a transaction (the reconciling boot
-- migrator executes statements autocommit, so this is safe); IF NOT EXISTS
-- makes it idempotent, and the migrator also tolerates duplicate_object.
-- Purely additive: no existing row, role or behavior changes.
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'lead_distributor';
