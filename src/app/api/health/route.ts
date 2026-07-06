import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    console.error("Health check failed (database unreachable):", err);
    return NextResponse.json(
      { status: "error", database: "unreachable", timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }

  try {
    // A bare `SELECT 1` only proves the Postgres server is reachable — it
    // doesn't prove migrations have actually been applied. This cheap,
    // read-only check (LIMIT 0, no rows returned) would have caught the
    // "relation users does not exist" incident immediately instead of only
    // surfacing when a real user tried to sign up.
    await db.execute(sql`SELECT 1 FROM users LIMIT 0`);
  } catch (err) {
    console.error("Health check failed (schema not migrated):", err);
    return NextResponse.json(
      { status: "error", database: "connected", schema: "missing", timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }

  return NextResponse.json({
    status: "ok",
    database: "connected",
    schema: "ok",
    timestamp: new Date().toISOString(),
  });
}
