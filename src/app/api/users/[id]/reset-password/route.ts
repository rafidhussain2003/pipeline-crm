import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { and, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { revokeAllRefreshTokensForUser } from "@/lib/refresh-tokens";
import { invalidateAllSessions } from "@/lib/auth/session-registry";
import { revokeTrustedDevicesForUser } from "@/lib/auth/device-trust";

// Admin/manager sets a new temporary password for an agent — same
// "type a temp password" UX as the Add Agent form, not an auto-generated
// + emailed password (no email provider is wired up in this app; see
// src/lib/email/provider.ts).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("agents:manage");
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const { newPassword } = await req.json();
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json({ error: "Temporary password must be at least 8 characters." }, { status: 400 });
  }

  const [target] = await db.select({ role: users.role }).from(users).where(and(eq(users.id, id), eq(users.companyId, session.companyId))).limit(1);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.role !== "admin" && target.role === "admin") {
    return NextResponse.json({ error: "Only an admin can reset another admin's password." }, { status: 403 });
  }

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash, passwordChangedAt: new Date() })
    .where(and(eq(users.id, id), eq(users.companyId, session.companyId)));

  // Administrator-forced logout: revoke the refresh chain, kill the live
  // session immediately (single-device registry), and drop every trusted
  // device — the next login requires the new password AND an email OTP.
  await revokeAllRefreshTokensForUser(id);
  await invalidateAllSessions(id);
  await revokeTrustedDevicesForUser(id);

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "agent.password_reset",
    entityType: "user",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}
