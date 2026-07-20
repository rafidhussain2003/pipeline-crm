import { NextRequest, NextResponse } from "next/server";
import { getSession, type CompanySession } from "@/lib/auth";
import { canAccessLead } from "@/lib/leads/access";
import { isUuid } from "@/lib/url";
import { getLeadInsights } from "@/lib/insights";
import { db } from "@/db";
import { leads, leadSources } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { canSeeActualSourceName, resolveSourceName } from "@/lib/leads/source-privacy";

// Lead AI Insights (Phase 9) — powers the one AI Insights card on the Lead
// Details page. Company-scoped: getLeadInsights returns null if the lead isn't
// in this company. Reads the cached insight and recomputes transparently if the
// lead changed since it was last computed, so the card is always current. This
// endpoint never mutates lead data and never touches the assignment engine.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  // A malformed id would otherwise reach a uuid column and surface as an
  // empty-bodied 500; treat it as the missing record it describes.
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Agent Portal: agents reach only their own leads (see lib/leads/access).
  if (!(await canAccessLead(session as CompanySession, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await getLeadInsights(id, session.companyId);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Phase 3 — the "Lead source" line in Customer Insights can carry the real
  // campaign name (website sources embed it). Insights are computed once and
  // CACHED for the whole company, so the alias cannot be applied at compute
  // time without making the cache role-specific. Resolving here keeps one
  // cached copy holding the truth for admins, and swaps in the alias per
  // request for everyone else. One indexed lookup, only for non-privileged
  // roles, only when the card is actually opened.
  if (!canSeeActualSourceName(session.role) && result.customerInsights?.leadSource) {
    const [src] = await db
      .select({ pageName: leadSources.pageName, alias: leadSources.agentDisplayName })
      .from(leads)
      .innerJoin(leadSources, eq(leads.sourceId, leadSources.id))
      .where(and(eq(leads.id, id), eq(leads.companyId, session.companyId)))
      .limit(1);
    if (src?.pageName && result.customerInsights.leadSource.includes(src.pageName)) {
      const shown = resolveSourceName(session.role, src.pageName, src.alias) ?? src.pageName;
      result.customerInsights.leadSource = result.customerInsights.leadSource.replaceAll(src.pageName, shown);
    }
  }

  return NextResponse.json(result);
}
