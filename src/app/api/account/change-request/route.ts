import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession, verifyPassword } from "@/lib/auth";
import { requestCode } from "@/lib/auth/verification";
import { sendAgentChangeApprovalEmail } from "@/lib/email/send";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";
import { findCompanyAdministrator } from "@/lib/companies/administrator";
import { and, eq, ne } from "drizzle-orm";

// Enterprise Agent Portal — step 1 of the administrator-approval workflow.
//
//   Agent submits request  →  system generates a verification code  →  the
//   code is emailed ONLY to the company administrator  →  the administrator
//   approves by giving the agent the code  →  the agent completes the change
//   (see ./complete).
//
// The agent never sees the code in any response; possession of it IS the
// administrator's approval. Every request is audited.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Admins and managers change these directly on their account — this
  // workflow exists for agents, whose direct paths are blocked.
  if (session.role !== "agent") {
    return NextResponse.json({ error: "Only agents use the approval workflow. Change your details in Profile > Account." }, { status: 400 });
  }

  const rl = checkPolicy("auth.password_change", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please wait a minute and try again." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const type = body.type === "email" || body.type === "password" ? (body.type as "email" | "password") : null;
  if (!type) return NextResponse.json({ error: "type must be \"email\" or \"password\"." }, { status: 400 });

  // The request itself is authenticated with the current password so a
  // borrowed session can't quietly start redirecting the account.
  const [me] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!me) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  if (typeof body.currentPassword !== "string" || !(await verifyPassword(body.currentPassword, me.passwordHash))) {
    return NextResponse.json({ error: "Your current password is required and must be correct." }, { status: 401 });
  }

  let newEmail: string | undefined;
  if (type === "email") {
    if (typeof body.newEmail !== "string" || !EMAIL_RE.test(body.newEmail)) {
      return NextResponse.json({ error: "Please enter a valid new email address." }, { status: 400 });
    }
    const candidate = String(body.newEmail).trim();
    newEmail = candidate;
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, candidate), ne(users.id, session.userId)))
      .limit(1);
    if (existing) return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
  }

  const admin = await findCompanyAdministrator(session.companyId);
  if (!admin) return NextResponse.json({ error: "No active administrator found for your company." }, { status: 400 });

  const purpose = type === "email" ? ("agent_email_change" as const) : ("agent_password_change" as const);
  // The code row lives under the ADMINISTRATOR's email — the agent can't
  // request a copy to their own inbox. The payload pins the requesting user
  // (and the exact approved email) for the completion step.
  const request = await requestCode({
    email: admin.email,
    purpose,
    payload: { userId: session.userId, ...(newEmail ? { newEmail } : {}) },
  });
  if (!request.ok) {
    return NextResponse.json({ error: request.error }, { status: 429 });
  }

  const sent = await sendAgentChangeApprovalEmail({
    adminEmail: admin.email,
    code: request.code,
    agentName: me.name,
    agentEmail: me.email,
    changeType: type,
    newEmail,
  });
  // Dev-mode convention (no email provider configured): code readable from
  // server logs, never from the response.
  if (!sent) console.warn(`[change-request] approval code for ${me.email} (${type}): ${request.code}`);

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "account.change_requested",
    entityType: "user",
    entityId: session.userId,
    metadata: { type, resend: request.resend, adminUserId: admin.id, ...(newEmail ? { newEmail } : {}) },
  });

  return NextResponse.json({
    ok: true,
    message: "Your administrator has been emailed a verification code. Enter it below once they approve.",
  });
}
