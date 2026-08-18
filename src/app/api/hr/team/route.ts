import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, companies } from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { hashPassword } from "@/lib/auth";
import { requireHR } from "@/lib/hr/guard";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";
import { eventBus } from "@/lib/events/bus";
import { sendInvitationEmail } from "@/lib/email/send";

// HR → HR Team. HR Employees are ordinary users with an HR-only footprint:
// role "hr_employee", module access limited to HR. The admin creates them
// here with a name, email and TEMPORARY password (they must set their own on
// first login, and get an invite email); from then on they log in and run the
// HR workspace themselves — employees, offer letters & agreements, documents,
// departments, designations, org chart, reports. They are created and managed
// HERE, never in the CRM Agents page, so the populations never mix.
//
// Admin-only (hr:admin): managing WHO runs HR is more sensitive than HR itself.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const auth = await requireHR("hr:admin");
  if (!auth.ok) return auth.response;

  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, active: users.active, createdAt: users.createdAt })
    .from(users)
    .where(and(eq(users.companyId, auth.session.companyId), eq(users.role, "hr_employee"), isNull(users.deletedAt)))
    .orderBy(asc(users.createdAt));

  return NextResponse.json({ employees: rows });
}

export async function POST(req: NextRequest) {
  const auth = await requireHR("hr:admin");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.admin", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!name) return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Temporary password must be at least 8 characters." }, { status: 400 });

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return NextResponse.json({ error: "That email is already in use." }, { status: 409 });

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({
      companyId: session.companyId,
      name,
      email,
      passwordHash,
      role: "hr_employee",
      active: true,
      // First login forces them to set their own password.
      mustChangePassword: true,
      // HR workspace ONLY — this is what keeps them out of the CRM and the
      // other back-office modules.
      moduleAccess: { crm: false, hr: true, finance: false, attendance: false, payroll: false, workflow: false },
    })
    .returning();

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "hr.employee_added",
    entityType: "user",
    entityId: user.id,
    after: { name: user.name, email: user.email, role: "hr_employee" },
  });
  await eventBus.emit("user.created", { userId: user.id, companyId: session.companyId, role: user.role });

  // Best-effort invite email with the temp password (never blocks creation).
  (async () => {
    try {
      const [co] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, session.companyId)).limit(1);
      await sendInvitationEmail({ email, name, companyName: co?.name || "your team", tempPassword: password });
    } catch {
      /* the admin can reset the temp password from the UI */
    }
  })();

  return NextResponse.json(
    { employee: { id: user.id, name: user.name, email: user.email, active: user.active, createdAt: user.createdAt } },
    { status: 201 }
  );
}
