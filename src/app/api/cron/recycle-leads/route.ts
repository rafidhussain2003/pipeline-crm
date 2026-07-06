import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { automationSettings, leads, companies } from "@/db/schema";
import { and, eq, isNull, isNotNull, lt, notInArray, sql } from "drizzle-orm";
import { assignLead, TERMINAL_DISPOSITIONS } from "@/lib/assignment";
import { recordAudit } from "@/lib/audit";

// Meant to be called periodically by an external scheduler — Render Cron
// Job, or any free service like cron-job.org — hitting this URL with the
// CRON_SECRET header. Not tied to any specific company; it sweeps every
// company that has auto-recycle enabled in one pass.
//
// "Stale" = has an owner, hasn't been touched (updatedAt) in longer than
// that company's configured recycleAfterMinutes, and isn't already
// closed out (won or "Not Interested" — see TERMINAL_DISPOSITIONS).
// Previously this only ever looked at leads still sitting at "New Lead" —
// broadened to any non-terminal disposition, so a lead stuck at "Busy" or
// "Answering Machine" (real call-center dispositions that mean "try
// again," not "done") gets swept too, not just brand-new leads.
//
// Recycling reassigns it to a different active agent so it doesn't just
// sit forgotten in one inbox — capped at maxRecycleCount per lead so a
// consistently unreachable lead doesn't cycle between agents forever;
// once capped, it's left alone for a human to review instead.
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companiesWithRecycle = await db
    .select({
      companyId: automationSettings.companyId,
      recycleAfterMinutes: automationSettings.recycleAfterMinutes,
      maxRecycleCount: automationSettings.maxRecycleCount,
    })
    .from(automationSettings)
    .innerJoin(companies, eq(automationSettings.companyId, companies.id))
    .where(and(eq(automationSettings.autoRecycleEnabled, true), isNull(companies.deletedAt)));

  let totalRecycled = 0;

  for (const { companyId, recycleAfterMinutes, maxRecycleCount } of companiesWithRecycle) {
    const cutoff = new Date(Date.now() - recycleAfterMinutes * 60_000);

    const staleLeads = await db
      .select({ id: leads.id, ownerId: leads.ownerId, recycleCount: leads.recycleCount })
      .from(leads)
      .where(
        and(
          eq(leads.companyId, companyId),
          notInArray(leads.disposition, TERMINAL_DISPOSITIONS),
          isNotNull(leads.ownerId),
          lt(leads.updatedAt, cutoff),
          lt(leads.recycleCount, maxRecycleCount),
          isNull(leads.deletedAt)
        )
      );

    for (const lead of staleLeads) {
      if (!lead.ownerId) continue;
      try {
        const newOwner = await assignLead(lead.id, companyId, null, lead.ownerId);
        if (newOwner) {
          // Atomic increment — see src/lib/supervisor.ts forceRecycleLead()
          // for why this can't be a read-then-write of `lead.recycleCount`:
          // this cron and a supervisor's force-recycle can race on the same
          // lead, and a JS-computed write would lose one of the increments.
          await db.update(leads).set({ recycleCount: sql`${leads.recycleCount} + 1` }).where(eq(leads.id, lead.id));
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
      } catch (err) {
        console.error(`Auto-recycle failed for lead ${lead.id} (company ${companyId}):`, err);
      }
    }
  }

  return NextResponse.json({ recycled: totalRecycled, companiesChecked: companiesWithRecycle.length });
}
