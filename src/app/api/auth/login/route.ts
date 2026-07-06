import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users, companies } from "@/db/schema";
import { verifyPassword, setSessionCookie, setRefreshCookie, REMEMBER_ME_SESSION_DAYS } from "@/lib/auth";
import { issueRefreshToken } from "@/lib/refresh-tokens";
import { recordAudit } from "@/lib/audit";
import { checkPolicy, getClientIp, checkAccountLockout, recordLoginFailure, recordLoginSuccess } from "@/lib/rate-limit";
import { eq } from "drizzle-orm";
import { withRoute } from "@/lib/api-handler";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  rememberMe: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  return withRoute("auth.login", "POST", req, async (logger, requestId) => {
    const ip = getClientIp(req);
    const rl = checkPolicy("auth.login", ip);
    if (!rl.allowed) {
      logger.warn("rate_limited", { ip });
      return NextResponse.json({ error: "Too many login attempts. Please wait a minute and try again." }, { status: 429 });
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    const { email, password, rememberMe } = parsed.data;
    const lockoutKey = `login:${email.toLowerCase()}`;

    const lockout = checkAccountLockout(lockoutKey);
    if (lockout.locked) {
      logger.warn("account_locked", { retryAfterMs: lockout.retryAfterMs });
      return NextResponse.json(
        { error: "Too many failed attempts on this account. Please try again later." },
        { status: 429 }
      );
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !user.active || user.deletedAt) {
      recordLoginFailure(lockoutKey);
      await recordAudit({
        companyId: null,
        userId: null,
        action: "auth.login_failed",
        entityType: "user",
        requestId,
        metadata: { email, reason: !user ? "not_found" : "inactive" },
      });
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      recordLoginFailure(lockoutKey);
      await recordAudit({
        companyId: user.companyId,
        userId: user.id,
        action: "auth.login_failed",
        entityType: "user",
        entityId: user.id,
        requestId,
        metadata: { reason: "wrong_password" },
      });
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    if (user.companyId) {
      const [company] = await db.select().from(companies).where(eq(companies.id, user.companyId)).limit(1);
      if (!company || company.status === "suspended" || company.deletedAt) {
        return NextResponse.json({ error: "This account is not active. Contact support." }, { status: 403 });
      }
    }

    recordLoginSuccess(lockoutKey);
    logger.setContext({ userId: user.id, companyId: user.companyId });

    const sessionDays = rememberMe ? REMEMBER_ME_SESSION_DAYS : undefined;
    await setSessionCookie(
      {
        userId: user.id,
        companyId: user.companyId,
        role: user.role,
        email: user.email,
      },
      sessionDays
    );

    const { rawToken, expiresAt } = await issueRefreshToken(user.id, req.headers.get("user-agent") || undefined);
    await setRefreshCookie(rawToken, expiresAt);

    await recordAudit({
      companyId: user.companyId,
      userId: user.id,
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
      requestId,
    });

    logger.info("login_success", { rememberMe: !!rememberMe });
    return NextResponse.json({ ok: true, role: user.role });
  });
}
