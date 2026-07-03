import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users, companies } from "@/db/schema";
import { verifyPassword, setSessionCookie, setRefreshCookie } from "@/lib/auth";
import { issueRefreshToken } from "@/lib/refresh-tokens";
import { recordAudit } from "@/lib/audit";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { eq } from "drizzle-orm";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`login:${ip}`, 10, 60_000); // 10 attempts/minute/IP
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many login attempts. Please wait a minute and try again." }, { status: 429 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.active || user.deletedAt) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  if (user.companyId) {
    const [company] = await db.select().from(companies).where(eq(companies.id, user.companyId)).limit(1);
    if (!company || company.status === "suspended" || company.deletedAt) {
      return NextResponse.json({ error: "This account is not active. Contact support." }, { status: 403 });
    }
  }

  await setSessionCookie({
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    email: user.email,
  });

  const { rawToken, expiresAt } = await issueRefreshToken(user.id, req.headers.get("user-agent") || undefined);
  await setRefreshCookie(rawToken, expiresAt);

  await recordAudit({
    companyId: user.companyId,
    userId: user.id,
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
  });

  return NextResponse.json({ ok: true, role: user.role });
}
