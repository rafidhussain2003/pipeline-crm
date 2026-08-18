import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { hashPassword } from "@/lib/auth";
import { requireHR } from "@/lib/hr/guard";
import { revokeAllRefreshTokensForUser } from "@/lib/refresh-tokens";
import { invalidateAllSessions } from "@/lib/auth/session-registry";
import { revokeTrustedDevicesForUser } from "@/lib/auth/device-trust";
import { recordAudit } from "@/lib/audit";
import { isUuid } from "@/lib/url";

// Same "kill every live session now" used when the CRM deactivates a user — a
// deactivation or password reset must take effect immediately.
async function forceLogout(userId: string) {
  await revokeAllRefreshTokensForUser(userId);
  await invalidateAllSessions(userId);
  await revokeTrustedDevicesForUser(userId);
}

// Edit an HR Employee: activate/deactivate, or reset their temporary password.
// Admin-only and tenant-scoped — the target must be an hr_employee of THIS
// company, or it's a 404 (never leak that a user exists in another tenant).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHR("hr:admin");
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [target] = await db
    .select({ id: users.id, active: users.active })
    .from(users)
    .where(and(eq(users.id, id), eq(users.companyId, session.companyId), eq(users.role, "hr_employee"), isNull(users.deletedAt)))
    .limit(1);
  if (!target) return NextResponse.json({ error: "HR employee not found." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const set: Partial<{ active: boolean; passwordHash: string; mustChangePassword: boolean }> = {};
  let killSessions = false;

  if (typeof body?.active === "boolean") {
    set.active = body.active;
    if (!body.active) killSessions = true; // deactivation takes effect now
  }
  if (typeof body?.password === "string" && body.password.length > 0) {
    if (body.password.length < 8) return NextResponse.json({ error: "Temporary password must be at least 8 characters." }, { status: 400 });
    set.passwordHash = await hashPassword(body.password);
    set.mustChangePassword = true;
    killSessions = true; // a reset invalidates existing sessions
  }
  if (Object.keys(set).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  await db.update(users).set(set).where(and(eq(users.id, id), eq(users.companyId, session.companyId)));
  if (killSessions) await forceLogout(id);

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "hr.employee_updated",
    entityType: "user",
    entityId: id,
    before: { active: target.active },
    after: { ...(set.active !== undefined ? { active: set.active } : {}), ...(set.passwordHash ? { passwordReset: true } : {}) },
  });

  return NextResponse.json({ ok: true });
}
