import { NextResponse } from "next/server";
import { db } from "@/db";
import { leadForms, leadSources } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, asc, eq, isNull } from "drizzle-orm";

// Facebook Forms — the company-wide alias management list (admin only). One
// flat list of every connected Lead Form across all Pages, each with its
// REAL Meta name (read-only) and the admin-editable Display Name (the alias
// agents see). Editing happens through the existing per-form PATCH
// (/api/lead-sources/[id]/forms/[formId]); this endpoint only reads.
//
// Admin-only by design: the real form names are campaign intelligence that
// managers and agents must never receive (see resolveFormName). Kept as a
// top-level route rather than /api/lead-sources/forms to avoid any
// static-vs-dynamic segment ambiguity beside /api/lead-sources/[id].
export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can manage form display names" }, { status: 403 });
  }

  const forms = await db
    .select({
      id: leadForms.id,
      sourceId: leadForms.sourceId,
      formId: leadForms.formId,
      // The REAL Meta name — admin-only surface, read-only, never modified.
      formName: leadForms.formName,
      // The admin-editable alias agents see.
      agentDisplayName: leadForms.agentDisplayName,
      enabled: leadForms.enabled,
      pageName: leadSources.pageName,
      platform: leadSources.platform,
    })
    .from(leadForms)
    .innerJoin(leadSources, eq(leadForms.sourceId, leadSources.id))
    // Tenant scope: only this company's sources; skip disconnected pages.
    .where(and(eq(leadSources.companyId, session.companyId), isNull(leadSources.deletedAt)))
    .orderBy(asc(leadSources.pageName), asc(leadForms.formName));

  return NextResponse.json({ forms });
}
