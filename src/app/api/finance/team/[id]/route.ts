import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { hashPassword } from "@/lib/auth";
import { requireFinanceAdmin } from "@/lib/finance/guard";
import { normalizeFinanceCapabilities, invalidateFinanceCapabilities } from "@/lib/finance/permissions";
import { revokeAllRefreshTokensForUser } from "@/lib/refresh-tokens";
import { invalidateAllSessions } from "@/lib/auth/session-registry";
import { revokeTrustedDevicesForUser } from "@/lib/auth/device-trust";
import { recordAudit } from "@/lib/audit";
import { isUuid } from "@/lib/url";

// Same "kill every live session now" used when the CRM deactivates a user — a
// deactivation or password reset must take effect immediately, not whenever the
// current access token happens to expire.
async function forceLogout(userId: string) {
  await revokeAllRefreshTokensForUser(userId);
  await invalidateAllSessions(userId);
  await revokeTrustedDevicesForUser(userId);
}

// Edit a Finance Employee: change their capabilities, activate/deactivate, or
// reset their temporary password. Admin-only and tenant-scoped — the target
// must be a finance_employee of THIS company, or it's a 404 (never leak that a
// user exists in another tenant).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinanceAdmin();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [target] = await db
    .select({ id: users.id, active: users.active, capabilities: users.financeCapabilities })
    .from(users)
    .where(and(eq(users.id, id), eq(users.companyId, session.companyId), eq(users.role, "finance_employee"), isNull(users.deletedAt)))
    .limit(1);
  if (!target) return NextResponse.json({ error: "Finance employee not found." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const set: Partial<{ financeCapabilities: Record<string, boolean>; active: boolean; passwordHash: string; mustChangePassword: boolean }> = {};
  let killSessions = false;

  if (body?.capabilities !== undefined) {
    set.financeCapabilities = normalizeFinanceCapabilities(body.capabilities);
  }
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

  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  await db.update(users).set(set).where(and(eq(users.id, id), eq(users.companyId, session.companyId)));
  if (set.financeCapabilities) await invalidateFinanceCapabilities(id);
  if (killSessions) await forceLogout(id);

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "finance.employee_updated",
    entityType: "user",
    entityId: id,
    before: { active: target.active, capabilities: normalizeFinanceCapabilities(target.capabilities) },
    after: {
      ...(set.active !== undefined ? { active: set.active } : {}),
      ...(set.financeCapabilities ? { capabilities: set.financeCapabilities } : {}),
      ...(set.passwordHash ? { passwordReset: true } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
