import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, companies } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { and, eq, isNull, ilike, or, asc } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";
import { checkAgentQuota } from "@/lib/tenant/limits";
import { eventBus } from "@/lib/events/bus";
import { sendInvitationEmail } from "@/lib/email/send";
import { sendNotification } from "@/lib/notifications/service";

// Assignable roles via this endpoint — "super_admin" is platform-level and
// never created here. There is no separate "owner" role (see schema.ts);
// it's computed below as the earliest-created admin per company.
const ASSIGNABLE_ROLES = ["admin", "manager", "agent"] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export async function GET(req: NextRequest) {
  // Broken function-level authorization: this listing was authenticated-only
  // while the PATCH/DELETE on the same resource both require "agents:manage".
  // Any agent could therefore enumerate the whole company directory — every
  // colleague's email, phone, role, tier and lock state — which is a ready-made
  // target list for phishing the admins it also identifies. Gated to match its
  // siblings; the only caller (/settings/agents) is already admin/manager-only,
  // so nothing an agent can legitimately reach depends on this.
  const auth = await requirePermission("agents:manage");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim();
  const status = searchParams.get("status"); // "active" | "disabled"
  const roleFilter = searchParams.get("role"); // "owner" | "admin" | "manager" | "agent"

  const conditions = [eq(users.companyId, session.companyId), isNull(users.deletedAt)];
  if (status === "active") conditions.push(eq(users.active, true));
  if (status === "disabled") conditions.push(eq(users.active, false));
  // "owner" isn't a stored role — filtered client-side below via isOwner,
  // since it's computed (earliest-created admin), not a column.
  if (roleFilter && roleFilter !== "owner" && (ASSIGNABLE_ROLES as readonly string[]).includes(roleFilter)) {
    conditions.push(eq(users.role, roleFilter as AssignableRole));
  }
  if (search) {
    const searchCond = or(ilike(users.name, `%${search}%`), ilike(users.email, `%${search}%`));
    if (searchCond) conditions.push(searchCond);
  }

  // Independent queries — fired concurrently so the response waits for the
  // slower of the two, not their sum (~1 DB round trip saved per call).
  const [rows, [earliestAdmin]] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        role: users.role,
        tier: users.tier,
        active: users.active,
        presenceStatus: users.presenceStatus,
        lastHeartbeatAt: users.lastHeartbeatAt,
        locked: users.locked,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(...conditions))
      .orderBy(asc(users.createdAt)),
    // "Owner" = the earliest-created admin for this company — a display
    // label only (see schema.ts's comment on why there's no stored "owner"
    // role). Computed from the full admin set, not the filtered/searched
    // rows, so search/filtering can't accidentally hide who the real owner
    // is from this calculation — but the row itself still only appears in
    // the response if it matches the current filters.
    db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.companyId, session.companyId), eq(users.role, "admin"), isNull(users.deletedAt)))
      .orderBy(asc(users.createdAt))
      .limit(1),
  ]);

  let result = rows.map((r) => ({ ...r, isOwner: r.role === "admin" && r.id === earliestAdmin?.id }));
  if (roleFilter === "owner") result = result.filter((r) => r.isOwner);

  return NextResponse.json({ users: result });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  // Required permission: agents:manage (admin or manager).
  const auth = await requirePermission("agents:manage");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.admin", session.userId);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  const { name, email, phone, password, tier, role } = await req.json();
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  }
  if (!email || typeof email !== "string" || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Temporary password must be at least 8 characters." }, { status: 400 });
  }

  const requestedRole: AssignableRole = (ASSIGNABLE_ROLES as readonly string[]).includes(role) ? role : "agent";
  // A manager can add agents and other managers, but not admins — creating
  // an admin is a bigger privilege grant than "Agents" management covers.
  if (requestedRole === "admin" && session.role !== "admin") {
    return NextResponse.json({ error: "Only an admin can add another admin." }, { status: 403 });
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
  }

  // Hard limit: block agent-seat creation once the company's plan limit is
  // reached. admin/manager aren't counted against (or blocked by) the
  // agent quota, matching how checkAgentQuota itself only counts
  // role="agent" rows.
  if (requestedRole === "agent") {
    const quota = await checkAgentQuota(session.companyId);
    if (!quota.allowed) {
      return NextResponse.json({ error: quota.warning || "Agent limit reached for this plan." }, { status: 402 });
    }
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({
      companyId: session.companyId,
      name: name.trim(),
      email,
      phone: phone || null,
      passwordHash,
      role: requestedRole,
      tier: tier || "1",
      active: true,
      // Phase 13: an invited user's temporary password can never become
      // permanent — they're forced to set their own on first login.
      mustChangePassword: true,
    })
    .returning();

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "agent.added",
    entityType: "user",
    entityId: user.id,
    after: { name: user.name, email: user.email, phone: user.phone, role: user.role, tier: user.tier },
  });

  await eventBus.emit("user.created", { userId: user.id, companyId: session.companyId, role: user.role });

  // Phase 13: send the invitation email with the temporary password + notify
  // the inviting admin. Both best-effort — a mail/notify failure never fails
  // the creation (the admin can resend/copy the temp password from the UI).
  //
  // FIRE-AND-FORGET, deliberately not awaited: the Resend call has no
  // timeout, so a slow/unreachable mail provider used to hold this response
  // (and the "Adding…" button) hostage for the full network timeout. The
  // agent is already created at this point — the response returns now and
  // the email goes out in the background.
  (async () => {
    try {
      const [co] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, session.companyId)).limit(1);
      await sendInvitationEmail({ email, name: name.trim(), companyName: co?.name || "your team", tempPassword: password });
    } catch (err) {
      console.error("Failed to send invitation email:", err);
    }
    await sendNotification({ companyId: session.companyId, userId: session.userId, type: "agent.invited", title: "Agent invited", body: `${name.trim()} (${email}) was invited to the team.`, metadata: { userId: user.id } }).catch(() => {});
  })();

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, tier: user.tier, active: user.active },
  });
}
