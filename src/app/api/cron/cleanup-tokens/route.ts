import { NextRequest, NextResponse } from "next/server";
import { cleanupExpiredRefreshTokens } from "@/lib/refresh-tokens";

// Meant to be called periodically (e.g. daily) by the same kind of external
// scheduler as /api/cron/recycle-leads — same CRON_SECRET header pattern.
// The refresh_tokens table has had no cleanup at all until now; every
// issued token (expired or revoked) stayed forever. Safe to run as often
// as convenient — deleting an already-deleted row is a no-op, and a
// currently-valid token is never touched (see cleanupExpiredRefreshTokens).
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deletedCount = await cleanupExpiredRefreshTokens();
  return NextResponse.json({ deletedCount });
}
