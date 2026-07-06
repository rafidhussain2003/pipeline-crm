import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { checkPolicy } from "@/lib/rate-limit";
import { forceRecycleLead } from "@/lib/supervisor";

// Supervisor Command Center: force recycle (Part 3) — immediately
// re-routes a lead away from its current owner, without waiting for the
// scheduled recycle-leads cron.
export async function POST(req: NextRequest) {
  const auth = await requirePermission("leads:supervise");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.admin", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const body = await req.json();
  const { leadId } = body;
  if (typeof leadId !== "string") {
    return NextResponse.json({ error: "leadId is required." }, { status: 400 });
  }

  const result = await forceRecycleLead(leadId, session.companyId, session.userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, agentId: result.value.agentId });
}
