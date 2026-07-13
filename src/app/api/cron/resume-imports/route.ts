import { NextRequest, NextResponse } from "next/server";
import { resumeStaleImports } from "@/lib/lead-sources/import-engine";

// Meant to be called periodically by the same external scheduler already
// hitting /api/cron/cleanup-tokens and /api/cron/recycle-leads (Render Cron
// Job, cron-job.org, etc.) with the CRON_SECRET header — every 1-2 minutes
// is enough. This is what makes a historical import survive a Render
// restart: the in-process loop that was running it dies with the process,
// but its checkpoint is already in Postgres, and this sweep notices the
// stalled heartbeat and resumes it from that checkpoint.
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resumed = await resumeStaleImports();
  return NextResponse.json({ resumed });
}
