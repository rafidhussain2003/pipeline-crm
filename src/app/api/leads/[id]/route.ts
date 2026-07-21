import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, assignmentLog, dispositionOptions } from "@/db/schema";
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

  // Reassigning a lead requires leads:assign (admin + manager — the Lead
  // Workspace's Assign permission); exempting it from auto-assignment stays
  // a supervisor decision (leads:supervise, Team dashboard). Everything else
  // on this endpoint (disposition, notes fields, etc.) is a normal everyday
  // edit any company member can make — on leads they can see. Without this,
  // any authenticated agent could reassign leads or blacklist them via a
  // raw API call, bypassing the Lock/workload-cap/routing rules entirely.
  if ("ownerId" in body && !hasPermission(session.role, "leads:assign")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if ("isBlacklisted" in body && !hasPermission(session.role, "leads:supervise")) {
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

  // Disposition validation — ONE source of truth: the company's own
  // disposition_options, the exact rows every dropdown renders. There is no
  // hardcoded whitelist to drift out of date, a dropdown-originated save can
  // never be rejected (its options ARE these rows), and an invalid value
  // from a raw API call gets an explicit 400 naming it — never a silent
  // failure. One indexed lookup on the (company_id, label) unique index.
  if ("disposition" in body) {
    if (typeof body.disposition !== "string" || !body.disposition.trim()) {
      return NextResponse.json({ error: "disposition must be a non-empty string" }, { status: 400 });
    }
    const [known] = await db
      .select({ id: dispositionOptions.id })
      .from(dispositionOptions)
      .where(and(eq(dispositionOptions.companyId, session.companyId), eq(dispositionOptions.label, body.disposition)))
      .limit(1);
    if (!known) {
      return NextResponse.json(
        { error: `"${body.disposition}" is not one of this company's dispositions` },
        { status: 400 }
      );
    }
  }

  // Follow-up & Pipeline: "Duplicate Lead" can link to the original lead.
  // Validated hard — the target must be a real, different lead in THIS
  // company (a raw id from another tenant 404s here and never lands in the
  // column), and linking also flags isDuplicate so lists badge it.
  if ("duplicateOfLeadId" in body) {
    const target = body.duplicateOfLeadId;
    if (target === null) {
      allowed.duplicateOfLeadId = null;
      allowed.isDuplicate = false;
    } else {
      if (typeof target !== "string" || !isUuid(target) || target === id) {
        return NextResponse.json({ error: "duplicateOfLeadId must be another lead's id." }, { status: 400 });
      }
      const [original] = await db
        .select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.id, target), eq(leads.companyId, session.companyId)))
        .limit(1);
      if (!original) return NextResponse.json({ error: "That lead could not be found." }, { status: 404 });
      allowed.duplicateOfLeadId = target;
      allowed.isDuplicate = true;
    }
  }

  // Assigning an owner here must stamp the same lifecycle state the
  // automatic engine writes (stage "assigned" + assignedAt) — without it the
  // recycle engine treated a hand-assigned lead as unworked queue stock and
  // quietly un-assigned it. Progressed stages are never regressed.
  if (body.ownerId && before.ownerId !== body.ownerId) {
    if (before.lifecycleStage === "new" || before.lifecycleStage === "queued") {
      allowed.lifecycleStage = "assigned";
      allowed.assignedAt = new Date();
    } else if (before.lifecycleStage === "assigned") {
      allowed.assignedAt = new Date();
    }
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
  if ("duplicateOfLeadId" in body && allowed.duplicateOfLeadId !== before.duplicateOfLeadId) {
    await recordAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: "lead.duplicate_linked",
      entityType: "lead",
      entityId: id,
      before: { duplicateOfLeadId: before.duplicateOfLeadId },
      after: { duplicateOfLeadId: allowed.duplicateOfLeadId },
    });
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
