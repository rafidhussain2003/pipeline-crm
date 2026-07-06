import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession, hashPassword } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { and, eq, isNull } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";
import { checkAgentQuota } from "@/lib/tenant/limits";
import { eventBus } from "@/lib/events/bus";

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, tier: users.tier, active: users.active })
    .from(users)
    .where(and(eq(users.companyId, session.companyId), isNull(users.deletedAt)));

  return NextResponse.json({ users: rows });
}

export async function POST(req: NextRequest) {
  // Required permission: users:create (admin only today).
  const auth = await requirePermission("users:create");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.admin", session.userId);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  const { name, email, password, tier, role } = await req.json();
  if (!name || !email || !password) {
    return NextResponse.json({ error: "Name, email, and password are required" }, { status: 400 });
  }

  // Hard limit: block agent creation once the company's plan limit is
  // reached. Only checked for role="agent" creations (the common case) —
  // admins aren't counted against the agent quota, matching how the quota
  // itself only counts role="agent" rows (see checkAgentQuota).
  if (role !== "admin") {
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
      name,
      email,
      passwordHash,
      role: role === "admin" ? "admin" : "agent",
      tier: tier || "1",
      active: true,
    })
    .returning();

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "agent.added",
    entityType: "user",
    entityId: user.id,
    after: { name: user.name, email: user.email, role: user.role, tier: user.tier },
  });

  await eventBus.emit("user.created", { userId: user.id, companyId: session.companyId, role: user.role });

  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, tier: user.tier } });
}
