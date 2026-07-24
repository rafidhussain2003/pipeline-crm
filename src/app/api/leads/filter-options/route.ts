import { NextResponse } from "next/server";
import { db } from "@/db";
import { leads, leadSources } from "@/db/schema";
import { getSession, type CompanySession } from "@/lib/auth";
import { leadVisibilityConditions } from "@/lib/leads/access";
import { resolveSourceName } from "@/lib/leads/source-privacy";
import { and, asc, eq, isNotNull, isNull, ne } from "drizzle-orm";

// Dropdown data for the Lead Filter bar: the Sources and States that actually
// occur in the CALLER'S VISIBLE leads. Both derive from the exact same
// leadVisibilityConditions the lead list uses, so:
//   • tenant isolation is automatic — only this company's values appear;
//   • an agent's options are limited to sources/states present in THEIR OWN
//     leads (never the whole company's), matching what they can filter to;
//   • source names go through the privacy layer (agents see the alias, never
//     the real campaign name).
// Dispositions come from /api/dispositions and agents from /api/leads/assignees
// (already used by the page); this endpoint fills only the two gaps.
export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const base = [...leadVisibilityConditions(session as CompanySession), isNull(leads.deletedAt)];

  try {
    const [sourceRows, stateRows] = await Promise.all([
      db
        .selectDistinct({ id: leadSources.id, pageName: leadSources.pageName, alias: leadSources.agentDisplayName })
        .from(leads)
        .innerJoin(leadSources, eq(leads.sourceId, leadSources.id))
        .where(and(...base)),
      db
        .selectDistinct({ state: leads.state })
        .from(leads)
        .where(and(...base, isNotNull(leads.state), ne(leads.state, "")))
        .orderBy(asc(leads.state)),
    ]);

    const sources = sourceRows
      .map((r) => ({ id: r.id, name: resolveSourceName(session.role, r.pageName, r.alias) }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const states = stateRows.map((r) => r.state).filter((s): s is string => !!s);

    return NextResponse.json({ sources, states });
  } catch (err) {
    // A filter-options hiccup must never break the leads page — degrade to
    // empty dropdowns (Search/Disposition/Agent still work) and log loudly.
    console.error("[leads/filter-options] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ sources: [], states: [] });
  }
}
