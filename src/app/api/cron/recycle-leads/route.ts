import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { automationSettings, leads, companies } from "@/db/schema";
import { and, eq, isNull, isNotNull, lt } from "drizzle-orm";
import { assignLead } from "@/lib/assignment";
import { recordAudit } from "@/lib/audit";

// Meant to be called periodically by an external scheduler — Render Cron
// Job, or any free service like cron-job.org — hitting this URL with the
// CRON_SECRET header. Not tied to any specific company; it sweeps every
// company that has auto-recycle enabled in one pass.
//
// "Stale" = still sitting at the default "New Lead" disposition, has an
// owner, and hasn't been touched (updatedAt) in longer than that company's
// configured recycleAfterMinutes. Recycling reassigns it to a different
// active agent so it doesn't just sit forgotten in one inbox.
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companiesWithRecycle = await db
    .select({ companyId: automationSettings.companyId, recycleAfterMinutes: automationSettings.recycleAfterMinutes })
    .from(automationSettings)
    .innerJoin(companies, eq(automationSettings.companyId, companies.id))
    .where(and(eq(automationSettings.autoRecycleEnabled, true), isNull(companies.deletedAt)));

  let totalRecycled = 0;

  for (const { companyId, recycleAfterMinutes } of companiesWithRecycle) {
    const cutoff = new Date(Date.now() - recycleAfterMinutes * 60_000);

    const staleLeads = await db
      .select({ id: leads.id, ownerId: leads.ownerId })
      .from(leads)
      .where(
        and(
          eq(leads.companyId, companyId),
          eq(leads.disposition, "New Lead"),
          isNotNull(leads.ownerId),
          lt(leads.updatedAt, cutoff),
          isNull(leads.deletedAt)
        )
      );

    for (const lead of staleLeads) {
      if (!lead.ownerId) continue;
      const newOwner = await assignLead(lead.id, companyId, null, lead.ownerId);
      if (newOwner) {
        totalRecycled++;
        await recordAudit({
          companyId,
          userId: null,
          action: "lead.auto_recycled",
          entityType: "lead",
          entityId: lead.id,
          metadata: { from: lead.ownerId, to: newOwner },
        });
      }
    }
  }

  return NextResponse.json({ recycled: totalRecycled, companiesChecked: companiesWithRecycle.length });
}
