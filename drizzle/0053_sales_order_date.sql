-- Sales Ledger V2 — add the free-text "Order Date" column (the date the sale
-- was made, kept separate from the free-text Installation Date). Additive and
-- idempotent; no existing data or behavior changes.
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "order_date" varchar(120);
