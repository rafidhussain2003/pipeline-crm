import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordSecurityEvent } from "@/lib/security/events";

// Bulk-copy audit sink. The agents-only client guard (AgentCopyGuard) calls
// this, best-effort, when it blocks an attempt to copy multiple leads at once
// from the leads table. Recording is the ONLY effect — the block already
// happened in the browser; this just leaves a security-event trail.
//
// Per-user throttle (in-memory, per instance): the client already rate-limits
// itself, but a hand-crafted request loop must not be able to flood the event
// log. One event per user per window; extra calls return 200 and record
// nothing.
const THROTTLE_MS = 5_000;
const lastByUser = new Map<string, number>();

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  // Only agents are guarded; anyone else copying is expected — record nothing.
  if (session.role !== "agent") return NextResponse.json({ ok: true });

  const now = Date.now();
  const prev = lastByUser.get(session.userId) ?? 0;
  if (now - prev < THROTTLE_MS) return NextResponse.json({ ok: true });
  lastByUser.set(session.userId, now);

  let chars = 0;
  try {
    const body = await req.json();
    if (body && typeof body.chars === "number" && Number.isFinite(body.chars)) {
      chars = Math.min(1_000_000, Math.max(0, Math.floor(body.chars)));
    }
  } catch {
    // No body / bad JSON — still worth recording the blocked attempt.
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  await recordSecurityEvent({
    event: "lead.bulk_copy_blocked",
    riskLevel: "medium",
    companyId: session.companyId,
    userId: session.userId,
    ip,
    userAgent: req.headers.get("user-agent"),
    reason: "bulk_copy_blocked",
    metadata: { chars },
  });

  return NextResponse.json({ ok: true });
}
