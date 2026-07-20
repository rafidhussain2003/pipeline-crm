import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requirePermission } from "@/lib/permissions";
import { and, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { revokeAllRefreshTokensForUser } from "@/lib/refresh-tokens";
import { invalidateAllSessions } from "@/lib/auth/session-registry";
import { revokeTrustedDevicesForUser } from "@/lib/auth/device-trust";

const ASSIGNABLE_ROLES = ["admin", "manager", "agent"] as const;

// Administrator-forced logout: dead session, dead refresh chain, dead device
// trust — the account cannot act again until (re-enabled and) freshly logged
// in with an OTP. Used on deactivation and removal below.
async function forceLogout(userId: string) {
  await revokeAllRefreshTokensForUser(userId);
  await invalidateAllSessions(userId);
  await revokeTrustedDevicesForUser(userId);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("agents:manage");
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  const body = await req.json();

  const [before] = await db.select().from(users).where(and(eq(users.id, id), eq(users.companyId, session.companyId))).limit(1);
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A manager can edit agents and other managers, but not an admin (and
  // can't promote anyone TO admin) — editing an admin is out of scope for
  // "Agents" management the same way creating one is (see POST /api/users).
  if (session.role !== "admin" && (before.role === "admin" || body.role === "admin")) {
    return NextResponse.json({ error: "Only an admin can manage another admin's account." }, { status: 403 });
  }

  // Prevent locking yourself out: disabling your own account here would
  // leave you unable to re-enable it (no one else may be around to do it).
  if (id === session.userId && "active" in body && body.active === false) {
    return NextResponse.json({ error: "You can't disable your own account." }, { status: 400 });
  }

  const allowed: Record<string, unknown> = {};
  for (const key of ["name", "phone", "tier", "active"]) {
    if (key in body) allowed[key] = body[key];
  }
  if ("role" in body) {
    if (!(ASSIGNABLE_ROLES as readonly string[]).includes(body.role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }
    allowed.role = body.role;
  }
  if ("name" in body && (typeof body.name !== "string" || !body.name.trim())) {
    return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
  }

  const [updated] = await db
    .update(users)
    .set(allowed)
    .where(and(eq(users.id, id), eq(users.companyId, session.companyId)))
    .returning();

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Disabling an account must end its access NOW, not when its JWT expires.
  if (before.active && updated.active === false) {
    await forceLogout(id);
  }

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "agent.updated",
    entityType: "user",
    entityId: id,
    before: { name: before.name, phone: before.phone, role: before.role, tier: before.tier, active: before.active },
    after: { name: updated.name, phone: updated.phone, role: updated.role, tier: updated.tier, active: updated.active },
  });

  return NextResponse.json({ user: updated });
}

// Soft delete — sets deletedAt and deactivates, keeps history intact.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("agents:manage");
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  if (id === session.userId) {
    return NextResponse.json({ error: "You can't delete your own account." }, { status: 400 });
  }

  const [target] = await db.select({ role: users.role }).from(users).where(and(eq(users.id, id), eq(users.companyId, session.companyId))).limit(1);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.role !== "admin" && target.role === "admin") {
    return NextResponse.json({ error: "Only an admin can remove another admin." }, { status: 403 });
  }

  const [deleted] = await db
    .update(users)
    .set({ deletedAt: new Date(), active: false })
    .where(and(eq(users.id, id), eq(users.companyId, session.companyId)))
    .returning();

  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await forceLogout(id);

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "agent.removed",
    entityType: "user",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}
