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
  });

if (process.env.NODE_ENV !== "production") global._pgPool = pool;

export const db = drizzle(pool, { schema });
