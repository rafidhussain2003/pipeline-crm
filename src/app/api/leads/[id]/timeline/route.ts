import { NextRequest, NextResponse } from "next/server";
import { getSession, type CompanySession } from "@/lib/auth";
import { canAccessLead } from "@/lib/leads/access";
import { isUuid } from "@/lib/url";
import { buildLeadTimeline } from "@/lib/insights/timeline";

// Unified lead timeline (Phase 9) — one chronological feed merging every event
// source that already exists for a lead: creation, assignments, lifecycle stage
// changes, notes, and audit-log entries. No new table and no new writes — this
// only reads back events other code paths already record, rendered with human
// labels. The merge lives in lib/insights/timeline so it is unit-testable.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  // A malformed id would otherwise reach a uuid column and surface as an
  // empty-bodied 500; treat it as the missing record it describes.
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Agent Portal: history is visible only for leads the agent owns —
  // same 404 as a nonexistent lead (see lib/leads/access).
  if (!(await canAccessLead(session as CompanySession, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const events = await buildLeadTimeline(id, session.companyId);
  if (events === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ events });
}
