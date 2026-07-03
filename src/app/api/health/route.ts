import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ status: "ok", database: "connected", timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("Health check failed:", err);
    return NextResponse.json(
      { status: "error", database: "unreachable", timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
