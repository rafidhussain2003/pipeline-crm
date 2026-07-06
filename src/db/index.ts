import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

const pool =
  global._pgPool ||
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
    // Without these, `pg` defaults to *no timeout* — a stalled connection
    // acquisition or a query stuck behind a lock would hang the request
    // forever instead of rejecting, no matter how much try/catch wraps it.
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 20_000,
    // `pg` defaults to max 10 connections per Pool if unset — fine for
    // local dev, but a single Render instance serving many concurrent
    // requests would exhaust that quickly and start queuing/timing out
    // every request behind it. 20 leaves headroom under a typical managed
    // Postgres plan's connection ceiling while still being well above the
    // old implicit default. Revisit if this instance is ever scaled to
    // multiple concurrent processes (each gets its own pool of this size).
    max: 20,
  });

if (process.env.NODE_ENV !== "production") global._pgPool = pool;

export const db = drizzle(pool, { schema });
