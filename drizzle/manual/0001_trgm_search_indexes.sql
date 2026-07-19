-- OPTIONAL zero-downtime variant. These indexes ARE created automatically by
-- the journaled migration drizzle/0035_trgm_search_indexes.sql, which every
-- deployment runs. You only need this file to apply them to a table that is
-- already large, where 0035's plain CREATE INDEX would block writes for too
-- long: run this first, then 0035 becomes a no-op (it is all IF NOT EXISTS).
--
-- Why these indexes aren't modeled in schema.ts as normal Drizzle indexes:
--   1. It requires the `pg_trgm` Postgres extension, which drizzle-orm's
--      schema DSL has no way to declare (there is no `CREATE EXTENSION`
--      equivalent in Drizzle's pgTable/pgEnum builders).
--   2. CREATE INDEX CONCURRENTLY cannot run inside a transaction block,
--      and drizzle's `migrate()` wraps every migration file in one — so
--      even if the index itself could be expressed in schema.ts, applying
--      it through the normal migration runner would fail outright.
--
-- What this does and why:
--   The lead search endpoint (GET /api/leads) does `ILIKE '%search%'` on
--   name/phone/email. A leading wildcard can't use a plain btree index —
--   Postgres has to scan every row for that company. At a handful of
--   companies with a few thousand leads each this is invisible; at the
--   stated growth target (10,000 companies, up to millions of leads per
--   company) it becomes a full scan on every search keystroke.
--   `pg_trgm` breaks text into trigrams and lets a GIN index accelerate
--   arbitrary substring ILIKE matches — this is the standard, widely-used
--   Postgres solution for this exact problem, not a novel abstraction.
--
-- How to run this:
--   Directly against your database, BEFORE the deploy that runs migration
--   0035. It cannot go through `npm run db:migrate` itself — CREATE INDEX
--   CONCURRENTLY fails inside drizzle's transaction:
--
--     psql "$DATABASE_URL" -f drizzle/manual/0001_trgm_search_indexes.sql
--
--   Every statement below is idempotent (IF NOT EXISTS) — safe to re-run.
--   CONCURRENTLY means index creation does not block reads/writes on
--   `leads` while it builds, at the cost of taking somewhat longer than a
--   plain CREATE INDEX. On Render's managed Postgres, the default
--   application database role has permission to create standard
--   extensions like pg_trgm; if this errors with a permissions message,
--   run it via a role with that grant instead.
--
-- When to run this:
--   Only when `leads` is already large enough that you cannot accept a brief
--   write lock during the deploy that runs migration 0035. On a new or small
--   database, skip this file entirely — 0035 handles it.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_name_trgm_idx
  ON leads USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_phone_trgm_idx
  ON leads USING gin (phone gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_email_trgm_idx
  ON leads USING gin (email gin_trgm_ops);

-- Postgres's query planner needs fresh statistics to know these indexes
-- are worth using for ILIKE queries on a table that already has data.
ANALYZE leads;
