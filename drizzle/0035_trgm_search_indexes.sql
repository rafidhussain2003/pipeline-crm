-- Trigram (pg_trgm) GIN indexes backing the two substring-search endpoints:
--   GET /api/leads                          — ILIKE '%q%' on name/phone/email
--   GET /api/mailbox/[mailboxId]/messages   — ILIKE '%q%' on subject/snippet/from_address
--
-- A leading wildcard cannot use a btree index, so without these Postgres scans
-- every row for the company on each search. pg_trgm decomposes text into
-- trigrams and lets GIN accelerate arbitrary substring matches.
--
-- These previously lived only in drizzle/manual/*.sql, outside the journal,
-- because CREATE INDEX CONCURRENTLY cannot run inside drizzle-kit's
-- transactional migrate() runner. The consequence was that a freshly
-- provisioned database silently came up without any of them. They are journaled
-- here using plain (non-CONCURRENTLY) CREATE INDEX, which is transaction-safe.
--
-- The tradeoff: a plain CREATE INDEX holds a lock that blocks writes to the
-- table while it builds. That is a non-issue on a new deployment, where both
-- tables are empty and the build is instantaneous. To apply these to an
-- already-large table without downtime, run the CONCURRENTLY variants in
-- drizzle/manual/ first — every statement here is IF NOT EXISTS, so a manual
-- pre-application simply makes this migration a no-op.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_name_trgm_idx" ON "leads" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_phone_trgm_idx" ON "leads" USING gin ("phone" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_email_trgm_idx" ON "leads" USING gin ("email" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_messages_subject_trgm_idx" ON "email_messages" USING gin ("subject" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_messages_snippet_trgm_idx" ON "email_messages" USING gin ("snippet" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_messages_from_trgm_idx" ON "email_messages" USING gin ("from_address" gin_trgm_ops);
