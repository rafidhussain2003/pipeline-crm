import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { sweepExpiredNotes } from "@/lib/notepad/server";

// Secure Notepad — the retention sweep endpoint. Sensitive values are kept
// readable for their window (12h / 7d / erased on "Active"), then auto-erased
// (DOB keeps its birth year). The app ALSO runs this same sweep hourly
// in-process (see src/instrumentation.ts) and lazily whenever an owner opens
// their notepad, so this endpoint is an optional external backstop — not
// required for the feature to work.
//
// Schedule it HOURLY if you use it (retention is 12h). Safe to run as often as
// you like: a note with nothing expired is a no-op and re-runs are idempotent.
// Authenticated by the same x-cron-secret as every other cron route, compared
// in constant time.
function cronSecretValid(provided: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !provided) return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!cronSecretValid(req.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sweepExpiredNotes();
  return NextResponse.json({ ok: true, ...result });
}
