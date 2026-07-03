import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can edit agents" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json();
  const allowed: Record<string, unknown> = {};
  for (const key of ["tier", "active", "name"]) {
    if (key in body) allowed[key] = body[key];
  }

  const [updated] = await db
    .update(users)
    .set(allowed)
    .where(and(eq(users.id, id), eq(users.companyId, session.companyId)))
    .returning();

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "agent.updated",
    entityType: "user",
    entityId: id,
    metadata: body,
  });

  return NextResponse.json({ user: updated });
}

// Soft delete — sets deletedAt and deactivates, keeps history intact.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can remove agents" }, { status: 403 });
  }
  const { id } = await params;

  const [deleted] = await db
    .update(users)
    .set({ deletedAt: new Date(), active: false })
    .where(and(eq(users.id, id), eq(users.companyId, session.companyId)))
    .returning();

  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "agent.removed",
    entityType: "user",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}
