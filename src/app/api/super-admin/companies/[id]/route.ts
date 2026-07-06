import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.admin", session.userId);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }
  const { id } = await params;
  const { status, customDomain, customDomainVerified } = await req.json();

  const [beforeRow] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);

  const allowed: Record<string, unknown> = { updatedAt: new Date() };
  if (status) allowed.status = status;
  if (customDomain !== undefined) allowed.customDomain = customDomain;
  if (customDomainVerified !== undefined) allowed.customDomainVerified = customDomainVerified;

  const [updated] = await db.update(companies).set(allowed).where(eq(companies.id, id)).returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await recordAudit({
    companyId: id,
    userId: session.userId,
    action: "company.status_changed",
    entityType: "company",
    entityId: id,
    before: beforeRow ? { status: beforeRow.status, customDomain: beforeRow.customDomain } : null,
    after: { status: updated.status, customDomain: updated.customDomain, customDomainVerified: updated.customDomainVerified },
  });

  return NextResponse.json({ company: updated });
}

// Soft delete — a suspended/removed company's data stays intact (soft
// delete cascades logically since every child table is filtered by
// companyId + a live parent), recoverable by clearing deletedAt manually if needed.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.super_admin", session.userId);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }
  const { id } = await params;

  const [deleted] = await db
    .update(companies)
    .set({ deletedAt: new Date(), status: "suspended" })
    .where(eq(companies.id, id))
    .returning();

  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await recordAudit({
    companyId: id,
    userId: session.userId,
    action: "company.deleted",
    entityType: "company",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}
