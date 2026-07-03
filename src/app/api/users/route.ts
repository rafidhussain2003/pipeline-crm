import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession, hashPassword } from "@/lib/auth";
import { and, eq, isNull } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";

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
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can add agents" }, { status: 403 });
  }
  const { name, email, password, tier, role } = await req.json();
  if (!name || !email || !password) {
    return NextResponse.json({ error: "Name, email, and password are required" }, { status: 400 });
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
  });

  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, tier: user.tier } });
}
