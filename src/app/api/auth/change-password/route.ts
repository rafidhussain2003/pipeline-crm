import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession, verifyPassword, hashPassword } from "@/lib/auth";
import { revokeAllRefreshTokensForUser } from "@/lib/refresh-tokens";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";
import { withRoute } from "@/lib/api-handler";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function POST(req: NextRequest) {
  return withRoute("auth.change-password", "POST", req, async (logger, requestId) => {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    logger.setContext({ userId: session.userId, companyId: session.companyId });

    const rl = checkPolicy("auth.password_change", session.userId);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many attempts. Please wait a minute and try again." }, { status: 429 });
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { currentPassword, newPassword } = parsed.data;

    // Explicit columns, not select() (full row) — same migration-lag
    // discipline as the login route: the forced first-login password change
    // must keep working even when the newest migration's columns aren't in
    // the database yet.
    const [user] = await db
      .select({
        id: users.id,
        companyId: users.companyId,
        passwordHash: users.passwordHash,
        mustChangePassword: users.mustChangePassword,
      })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    // Enterprise Agent Portal: agents change their password only through the
    // administrator-approval workflow (/api/account/change-request). The one
    // exception is the forced first-login change — an invited agent replacing
    // the temporary password their admin just handed them IS the admin-
    // sanctioned path, and must keep working.
    if (session.role === "agent" && !user.mustChangePassword) {
      return NextResponse.json(
        { error: "Agents can't change their password directly. Use the change request — your administrator must approve it." },
        { status: 403 }
      );
    }

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      logger.warn("wrong_current_password");
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }

    if (currentPassword === newPassword) {
      return NextResponse.json({ error: "New password must be different from the current password" }, { status: 400 });
    }

    const newHash = await hashPassword(newPassword);
    // Phase 13: setting a real password clears the force-change flag — a
    // temporary password can never become permanent.
    await db.update(users).set({ passwordHash: newHash, passwordChangedAt: new Date(), mustChangePassword: false }).where(eq(users.id, user.id));

    // Force re-authentication everywhere else. The current tab's session
    // cookie is a stateless JWT and stays valid until it naturally expires
    // (this app doesn't have short-lived access tokens + silent refresh
    // wired up yet — see the report's remaining issues) but every other
    // device/session's refresh token is revoked immediately.
    await revokeAllRefreshTokensForUser(user.id);

    await recordAudit({
      companyId: user.companyId,
      userId: user.id,
      action: "user.password_changed",
      entityType: "user",
      entityId: user.id,
      requestId,
    });

    logger.info("password_changed");
    return NextResponse.json({ ok: true });
  });
}
