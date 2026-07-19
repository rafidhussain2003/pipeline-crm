-- OPTIONAL zero-downtime variant, same as 0001_trgm_search_indexes.sql. The
-- journaled migration drizzle/0035_trgm_search_indexes.sql already creates
-- these on every deployment; use this file only to build them CONCURRENTLY on
-- an email_messages table that is already large enough that 0035's plain
-- CREATE INDEX would block writes for too long.
--
-- What this does and why:
--   The Platform Owner mailbox search (GET /api/mailbox/[mailboxId]/messages?q=)
--   does `ILIKE '%q%'` across subject / snippet / from_address. A leading
--   wildcard can't use a plain btree index, so without this Postgres scans the
--   whole mailbox on each search. pg_trgm + a GIN index makes those substring
--   matches index-backed — the "indexed search" requirement — using the same
--   standard approach as the lead search indexes.
--
-- How to run this (directly, BEFORE the deploy that runs migration 0035 —
-- CREATE INDEX CONCURRENTLY fails inside drizzle's transaction):
--     psql "$DATABASE_URL" -f drizzle/manual/0002_mailbox_search_indexes.sql
--   Every statement is idempotent (IF NOT EXISTS) — safe to re-run.
--   CONCURRENTLY builds without blocking reads/writes on email_messages.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS email_messages_subject_trgm_idx
  ON email_messages USING gin (subject gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS email_messages_snippet_trgm_idx
  ON email_messages USING gin (snippet gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS email_messages_from_trgm_idx
  ON email_messages USING gin (from_address gin_trgm_ops);
