import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { requireSuperAdmin } from "@/lib/permissions";
import { cache } from "@/lib/infra/cache";
import { metrics } from "@/lib/infra/metrics";

// A first, real "system health" view for the super-admin (Part 10):
// database connectivity/schema status (same check as /api/health, which is
// public and unauthenticated — this is the same fact, for an authenticated
// operator), in-memory cache hit rate, and the request/job failure
// counters collected since this process last restarted (see
// src/lib/infra/metrics.ts's doc comment on why that's a point-in-time
// view, not durable history).
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  let database: "connected" | "unreachable" = "connected";
  let schema: "ok" | "missing" = "ok";
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    database = "unreachable";
  }
  if (database === "connected") {
    try {
      await db.execute(sql`SELECT 1 FROM users LIMIT 0`);
    } catch {
      schema = "missing";
    }
  }

  return NextResponse.json({
    database,
    schema,
    cache: cache.stats(),
    metrics: metrics.snapshot(),
    timestamp: new Date().toISOString(),
  });
}
