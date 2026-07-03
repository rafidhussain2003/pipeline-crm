import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { assignmentRules } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.select().from(assignmentRules).where(eq(assignmentRules.companyId, session.companyId));
  return NextResponse.json({ rules: rows });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can edit assignment rules" }, { status: 403 });
  }
  const { tier, weight, active } = await req.json();
  if (!tier) return NextResponse.json({ error: "tier is required" }, { status: 400 });

  const allowed: Record<string, unknown> = {};
  if (weight !== undefined) allowed.weight = weight;
  if (active !== undefined) allowed.active = active;

  const [updated] = await db
    .update(assignmentRules)
    .set(allowed)
    .where(and(eq(assignmentRules.companyId, session.companyId), eq(assignmentRules.tier, tier)))
    .returning();

  return NextResponse.json({ rule: updated });
}
