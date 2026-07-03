import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();

  const [before] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.companyId, session.companyId))).limit(1);
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowed: Record<string, unknown> = {};
  for (const key of ["disposition", "ownerId", "followUpAt", "name", "phone", "email", "state"]) {
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
  }
  if ("ownerId" in body && body.ownerId !== before.ownerId) {
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
  const { id } = await params;

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
