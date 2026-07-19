import "dotenv/config";
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // TLS must be carried IN this URL as `?sslmode=require`, not as a
    // sibling `ssl` option. drizzle-kit parses dbCredentials with a zod
    // union whose `{ url }` branch has no `ssl` field, and zod's default
    // "strip" mode silently discards it — an `ssl` key here type-checks,
    // runs, and does nothing. Managed Postgres then resets the cleartext
    // connection and drizzle-kit reports it as a bare `exit 1` with no
    // diagnostics. See README "Database TLS".
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;