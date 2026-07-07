import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession, verifyPassword } from "@/lib/auth";
import { eq, and, ne } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";

// Profile > Account tab. Every authenticated user (any role) edits only
// their own row here — there's no id in the URL on purpose, it's always
// "the current session's user."
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [user] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ user });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const body = await req.json();
  const [before] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if ("name" in body && (typeof body.name !== "string" || !body.name.trim())) {
    return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
  }

  const changingEmail = "email" in body && body.email !== before.email;
  if (changingEmail) {
    if (typeof body.email !== "string" || !EMAIL_RE.test(body.email)) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    // Changing the login email is sensitive — require the current
    // password, same as changing the password itself, rather than
    // letting a hijacked session silently redirect the account.
    if (typeof body.currentPassword !== "string" || !(await verifyPassword(body.currentPassword, before.passwordHash))) {
      return NextResponse.json({ error: "Current password is required and must be correct to change your email." }, { status: 401 });
    }
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, body.email), ne(users.id, session.userId)))
      .limit(1);
    if (existing) {
      return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
    }
  }

  const allowed: Record<string, unknown> = {};
  if ("name" in body) allowed.name = body.name.trim();
  if (changingEmail) allowed.email = body.email;
  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  const [updated] = await db.update(users).set(allowed).where(eq(users.id, session.userId)).returning({ name: users.name, email: users.email });

  if (changingEmail) {
    await recordAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: "account.email_changed",
      entityType: "user",
      entityId: session.userId,
      before: { email: before.email },
      after: { email: updated.email },
    });
  } else {
    await recordAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: "account.updated",
      entityType: "user",
      entityId: session.userId,
      before: { name: before.name },
      after: { name: updated.name },
    });
  }

  return NextResponse.json({ user: updated });
}
