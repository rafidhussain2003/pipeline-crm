import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { verifyCode } from "@/lib/auth/verification";
import { hashPassword } from "@/lib/auth";
import { revokeAllRefreshTokensForUser } from "@/lib/refresh-tokens";
import { recordAudit } from "@/lib/audit";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";
import { withRoute } from "@/lib/api-handler";

const schema = z.object({ email: z.string().email(), code: z.string().min(4).max(8), newPassword: z.string().min(8) });

// Password reset step 2: verify the code + set a new password. On success,
// clears the force-change flag and revokes every session/refresh token so a
// compromised session can't survive a reset.
export async function POST(req: NextRequest) {
  return withRoute("auth.reset-password", "POST", req, async (logger, requestId) => {
    if (!checkPolicy("auth.password_reset", getClientIp(req)).allowed) {
      return NextResponse.json({ error: "Too many attempts. Please wait a minute." }, { status: 429 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter the code and a new password (8+ characters)." }, { status: 400 });
    const { email, code, newPassword } = parsed.data;

    const verified = await verifyCode({ email, purpose: "password_reset", code });
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 400 });

    const [user] = await db.select().from(users).where(and(eq(users.email, email.toLowerCase()), isNull(users.deletedAt))).limit(1);
    if (!user) return NextResponse.json({ ok: true }); // code consumed; nothing to do

    const newHash = await hashPassword(newPassword);
    await db.update(users).set({ passwordHash: newHash, passwordChangedAt: new Date(), mustChangePassword: false }).where(eq(users.id, user.id));
    await revokeAllRefreshTokensForUser(user.id);

    await recordAudit({ companyId: user.companyId, userId: user.id, action: "user.password_reset", entityType: "user", entityId: user.id, requestId });
    logger.info("password_reset_complete");
    return NextResponse.json({ ok: true });
  });
}
