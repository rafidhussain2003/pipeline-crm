import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { checkPolicy } from "@/lib/rate-limit";
import { isUuid } from "@/lib/url";
import { bulkAssignLeads } from "@/lib/supervisor";

// Enterprise Manual Assignment (leads page): assign one or many selected
// leads to one agent. Single and bulk are the same operation — a one-element
// array — so "works with exactly one lead selected" is true by construction.
//
// Guarded by the same permission as every other owner-changing path
// (supervisor force-assign, the leads/[id] PATCH ownerId branch): a company
// member without leads:supervise gets a 403 here no matter what the UI shows.
const MAX_BULK = 100; // matches the largest leads-page size — one page max

export async function POST(req: NextRequest) {
  const auth = await requirePermission("leads:supervise");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.admin", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  let body: { leadIds?: unknown; agentId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { leadIds, agentId } = body;
  if (typeof agentId !== "string" || !isUuid(agentId)) {
    return NextResponse.json({ error: "agentId is required." }, { status: 400 });
  }
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return NextResponse.json({ error: "leadIds must be a non-empty array." }, { status: 400 });
  }
  // Dedupe before validating: double-submitted ids should not double-log.
  const ids = [...new Set(leadIds)];
  if (ids.length > MAX_BULK) {
    return NextResponse.json({ error: `At most ${MAX_BULK} leads can be assigned at once.` }, { status: 400 });
  }
  if (!ids.every((id) => typeof id === "string" && isUuid(id))) {
    return NextResponse.json({ error: "leadIds must be lead ids." }, { status: 400 });
  }

  const result = await bulkAssignLeads(ids as string[], session.companyId, agentId, session.userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, ...result.value });
}
