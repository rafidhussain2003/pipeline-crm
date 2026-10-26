-- Sales Ledger: parsed ORDER DATE (order_on) the From/To filter keys on. Additive + idempotent.
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "order_on" date;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_company_order_on_idx" ON "sales" USING btree ("company_id","order_on");