-- Sales trash bin: deleted sales are kept 30 days then purged by the cron
-- worker. Index deleted_at so the purge sweep is an index range scan, never a
-- full-table scan. Additive + idempotent.
CREATE INDEX IF NOT EXISTS "sales_deleted_at_idx" ON "sales" USING btree ("deleted_at");
