import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { userSkills, users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { and, eq } from "drizzle-orm";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [agent] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, id), eq(users.companyId, session.companyId))).limit(1);
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db.select().from(userSkills).where(eq(userSkills.userId, id));
  return NextResponse.json({ skillIds: rows.map((r) => r.skillId) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("agents:manage");
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  const { skillId } = await req.json();
  if (!skillId) return NextResponse.json({ error: "skillId is required" }, { status: 400 });

  const [agent] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, id), eq(users.companyId, session.companyId))).limit(1);
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.insert(userSkills).values({ userId: id, skillId }).onConflictDoNothing();
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("agents:manage");
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const skillId = searchParams.get("skillId");
  if (!skillId) return NextResponse.json({ error: "skillId is required" }, { status: 400 });

  const [agent] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, id), eq(users.companyId, session.companyId))).limit(1);
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.delete(userSkills).where(and(eq(userSkills.userId, id), eq(userSkills.skillId, skillId)));
  return NextResponse.json({ ok: true });
}
