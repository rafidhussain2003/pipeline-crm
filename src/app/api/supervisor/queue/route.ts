import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, users, dispositionOptions, automationSettings } from "@/db/schema";
import { requirePermission } from "@/lib/permissions";
import { checkPolicy } from "@/lib/rate-limit";
import { and, eq, isNull, isNotNull, gt, lt, notInArray, inArray, desc, count } from "drizzle-orm";
import { TERMINAL_DISPOSITIONS } from "@/lib/assignment";

// Live queue view for the Team dashboard (Part 2). Disposition labels are
// per-company customizable (see dispositionOptions), so "answering
// machine" / "callback" groups are matched by pattern against whatever
// labels a company actually configured, rather than assuming fixed label
// text exists.
const GROUPS = ["unassigned", "assigned", "recycled", "stale", "answering_machine", "callback", "high_priority"] as const;
type Group = (typeof GROUPS)[number];

async function matchedDispositionLabels(companyId: string, pattern: RegExp): Promise<string[]> {
  const rows = await db.select({ label: dispositionOptions.label }).from(dispositionOptions).where(eq(dispositionOptions.companyId, companyId));
  return rows.map((r) => r.label).filter((label) => pattern.test(label));
}

// Returns null when a group has no matching leads possible at all (e.g. no
// disposition configured for it yet) — callers treat that as "empty",
// without running a doomed query.
async function conditionFor(group: Group, companyId: string) {
  const base = [eq(leads.companyId, companyId), isNull(leads.deletedAt)];
  switch (group) {
    case "unassigned":
      return and(...base, isNull(leads.ownerId), notInArray(leads.disposition, TERMINAL_DISPOSITIONS));
    case "assigned":
      return and(...base, isNotNull(leads.ownerId), notInArray(leads.disposition, TERMINAL_DISPOSITIONS));
    case "recycled":
      return and(...base, gt(leads.recycleCount, 0), notInArray(leads.disposition, TERMINAL_DISPOSITIONS));
    case "stale": {
      const [settings] = await db
        .select({ recycleAfterMinutes: automationSettings.recycleAfterMinutes })
        .from(automationSettings)
        .where(eq(automationSettings.companyId, companyId))
        .limit(1);
      const cutoff = new Date(Date.now() - (settings?.recycleAfterMinutes ?? 1440) * 60_000);
      return and(...base, isNotNull(leads.ownerId), lt(leads.updatedAt, cutoff), notInArray(leads.disposition, TERMINAL_DISPOSITIONS));
    }
    case "high_priority":
      return and(...base, eq(leads.priority, "high"), notInArray(leads.disposition, TERMINAL_DISPOSITIONS));
    case "answering_machine": {
      const labels = await matchedDispositionLabels(companyId, /answering machine/i);
      if (labels.length === 0) return null;
      return and(...base, inArray(leads.disposition, labels));
    }
    case "callback": {
      const labels = await matchedDispositionLabels(companyId, /callback/i);
      if (labels.length === 0) return null;
      return and(...base, inArray(leads.disposition, labels));
    }
  }
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission("leads:supervise");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const { searchParams } = new URL(req.url);
  const groupParam = searchParams.get("group");

  // Fetching the actual list for one group is a separate, on-demand call
  // (only when a supervisor opens that group's tab) — the default poll
  // only asks for counts, so a live-refreshing dashboard doesn't pull
  // dozens of lead rows per group on every tick.
  if (groupParam) {
    if (!(GROUPS as readonly string[]).includes(groupParam)) {
      return NextResponse.json({ error: "Invalid group." }, { status: 400 });
    }
    const condition = await conditionFor(groupParam as Group, session.companyId);
    if (!condition) return NextResponse.json({ leads: [] });

    const rows = await db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        disposition: leads.disposition,
        priority: leads.priority,
        recycleCount: leads.recycleCount,
        ownerId: leads.ownerId,
        ownerName: users.name,
        updatedAt: leads.updatedAt,
      })
      .from(leads)
      .leftJoin(users, eq(leads.ownerId, users.id))
      .where(condition)
      .orderBy(desc(leads.updatedAt))
      .limit(50);

    return NextResponse.json({ leads: rows });
  }

  const counts = await Promise.all(
    GROUPS.map(async (g) => {
      const condition = await conditionFor(g, session.companyId);
      if (!condition) return [g, 0] as const;
      const [row] = await db.select({ value: count() }).from(leads).where(condition);
      return [g, row?.value || 0] as const;
    })
  );

  return NextResponse.json({ counts: Object.fromEntries(counts) });
}
