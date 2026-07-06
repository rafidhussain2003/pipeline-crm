import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { checkPolicy } from "@/lib/rate-limit";
import { forceAssignLead } from "@/lib/supervisor";

// Supervisor Command Center: force assign / reassign (Part 3). One
// endpoint handles both — "assign" and "reassign" are the same operation
// (set the owner), the only difference is whether the lead already had one.
export async function POST(req: NextRequest) {
  const auth = await requirePermission("leads:supervise");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.admin", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const body = await req.json();
  const { leadId, agentId } = body;
  if (typeof leadId !== "string" || typeof agentId !== "string") {
    return NextResponse.json({ error: "leadId and agentId are required." }, { status: 400 });
  }

  const result = await forceAssignLead(leadId, session.companyId, agentId, session.userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, ownerId: result.value.ownerId });
}
