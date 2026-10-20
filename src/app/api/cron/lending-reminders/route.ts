import { NextRequest, NextResponse } from "next/server";
import { sendDueEmiReminders } from "@/lib/lending";

// Lending Bank — EMI reminder emails (3 days before + on the due date). The
// web service already runs this daily in-process (src/instrumentation.ts);
// this endpoint is an optional external-scheduler backstop. Idempotent: each
// reminder is stamped on the EMI, so extra runs send nothing twice.
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await sendDueEmiReminders());
}
