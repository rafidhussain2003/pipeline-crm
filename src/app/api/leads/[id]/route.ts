import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, assignmentLog } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { isUuid } from "@/lib/url";
import { hasPermission } from "@/lib/permissions";
import { and, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { transitionLifecycle } from "@/lib/lifecycle/service";
import { dispositionToLifecycle } from "@/lib/lifecycle/stages";
import { eventBus } from "@/lib/events/bus";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  // A malformed id would otherwise reach a uuid column and surface as an
  // empty-bodied 500; treat it as the missing record it describes.
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();

  // Reassigning a lead or exempting it from auto-assignment are supervisor
  // decisions (same permission the Team dashboard's force-assign requires)
  // — everything else on this endpoint (disposition, notes fields, etc.)
  // is a normal everyday edit any company member can make. Without this,
  // any authenticated agent could reassign leads or blacklist them via a
  // raw API call, bypassing the Lock/workload-cap/routing rules entirely.
  if (("ownerId" in body || "isBlacklisted" in body) && !hasPermission(session.role, "leads:supervise")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [before] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.companyId, session.companyId))).limit(1);
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Agent Portal: an agent may edit ONLY leads assigned to them. Same 404 a
  // nonexistent lead produces — the existence of other people's leads is not
  // revealed. Admin/manager behavior is unchanged.
  if (session.role === "agent" && before.ownerId !== session.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allowed: Record<string, unknown> = {};
  for (const key of ["disposition", "ownerId", "followUpAt", "name", "phone", "email", "state", "priority", "isBlacklisted"]) {
    if (key in body) allowed[key] = body[key];
  }
  allowed.updatedAt = new Date();

  const [updated] = await db
    .update(leads)
    .set(allowed)
    .where(and(eq(leads.id, id), eq(leads.companyId, session.companyId)))
    .returning();

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if ("disposition" in body && body.disposition !== before.disposition) {
    await recordAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: "lead.disposition_changed",
      entityType: "lead",
      entityId: id,
      metadata: { from: before.disposition, to: body.disposition },
    });
    // Phase 11: signal the disposition change so the Conversions API can send
    // the mapped Meta event. Fire-and-forget — the CAPI listener only enqueues
    // (never blocks this request), and it never sends synchronously.
    await eventBus.emit("lead.disposition_changed", { leadId: id, companyId: session.companyId, from: before.disposition, to: String(body.disposition) });
    // Phase 4: an agent changing the disposition advances the lifecycle
    // (contacted / won / lost). Guarded so it never regresses a further-along
    // stage. Best-effort — a lifecycle write must never fail the edit.
    const nextStage = dispositionToLifecycle(body.disposition);
    if (nextStage) {
      try {
        await transitionLifecycle({
          leadId: id,
          companyId: session.companyId,
          toStage: nextStage,
          reason: `disposition:${body.disposition}`,
          actorUserId: session.userId,
          onlyFrom: nextStage === "contacted" ? ["new", "queued", "assigned"] : undefined,
        });
      } catch (err) {
        console.error("lifecycle transition failed for lead", id, err);
      }
    }
  }
  if ("ownerId" in body && body.ownerId !== before.ownerId) {
    // Any path that changes ownerId must also log to assignment_log — the
    // "assignments today" counts (Team dashboard) and the round-robin
    // cursor (see assignLead()) both derive from this table, and would
    // silently under-count/skew if a reassignment only showed up in
    // audit_log. The Team dashboard's force-assign already does this (see
    // src/lib/supervisor.ts); this is the other place ownerId can change.
    if (body.ownerId) {
      await db.insert(assignmentLog).values({ leadId: id, assignedTo: body.ownerId, ruleUsed: "manual:direct_edit" });
      // Same event every other assignment path emits — notifications,
      // insights, and the leads-page live stream (open tabs see the owner
      // change without refreshing) all key off it.
      await eventBus.emit("lead.assigned", { leadId: id, companyId: session.companyId, agentId: String(body.ownerId) });
    }
    await recordAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: "lead.reassigned",
      entityType: "lead",
      entityId: id,
      metadata: { from: before.ownerId, to: body.ownerId },
    });
  }

  return NextResponse.json({ lead: updated });
}

// Soft delete — sets deletedAt instead of removing the row, so leads can be
// recovered and audit history stays intact.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Agent Portal: agents may never delete leads — not even their own.
  // Admin/manager behavior is unchanged.
  if (session.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  // A malformed id would otherwise reach a uuid column and surface as an
  // empty-bodied 500; treat it as the missing record it describes.
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [deleted] = await db
    .update(leads)
    .set({ deletedAt: new Date() })
    .where(and(eq(leads.id, id), eq(leads.companyId, session.companyId)))
    .returning();

  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "lead.deleted",
    entityType: "lead",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}
