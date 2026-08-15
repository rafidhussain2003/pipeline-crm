-- Commercial Sales becomes an INDEPENDENT, permanent sheet.
--   • sale_id becomes nullable (null = standalone admin row, or a caught row
--     whose sale was later purged).
--   • Every row gains its OWN customer/date/product/status columns: standalone
--     rows are typed by the admin; caught rows get a snapshot (kept in sync by
--     the sale write-through while the sale exists).
--   • The FK stops CASCADING deletes: purging a sale on the main ledger now
--     SET NULLs the link instead of destroying the commercial row — nothing on
--     the main ledger can ever remove a row from this sheet.
--   • Backfill: rows caught before this migration copy their sale's data into
--     the new snapshot columns.
-- Additive + idempotent (the FK swap re-runs harmlessly: DROP IF EXISTS + the
-- duplicate_object guard; the backfill only fills still-empty snapshots).
ALTER TABLE "commercial_sales" ALTER COLUMN "sale_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_sales" ADD COLUMN IF NOT EXISTS "customer_name" varchar(200);--> statement-breakpoint
ALTER TABLE "commercial_sales" ADD COLUMN IF NOT EXISTS "order_date" varchar(120);--> statement-breakpoint
ALTER TABLE "commercial_sales" ADD COLUMN IF NOT EXISTS "product" varchar(160);--> statement-breakpoint
ALTER TABLE "commercial_sales" ADD COLUMN IF NOT EXISTS "activation_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_sales" DROP CONSTRAINT IF EXISTS "commercial_sales_sale_id_sales_id_fk";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commercial_sales" ADD CONSTRAINT "commercial_sales_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
UPDATE "commercial_sales" SET
	"customer_name" = s."customer_name",
	"order_date" = s."order_date",
	"product" = s."product",
	"activation_status" = s."activation_status"
FROM "sales" s
WHERE "commercial_sales"."sale_id" = s."id" AND "commercial_sales"."customer_name" IS NULL;
