-- Sales Ledger + Commercial Sales: capture the customer's provider account
-- number (e.g. DirecTV account) so the backend team can handle installation /
-- billing after activation. Additive + idempotent.
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "account_number" varchar(160);--> statement-breakpoint
ALTER TABLE "commercial_sales" ADD COLUMN IF NOT EXISTS "account_number" varchar(160);
