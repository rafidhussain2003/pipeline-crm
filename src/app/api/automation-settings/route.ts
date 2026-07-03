import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { automationSettings } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [settings] = await db.select().from(automationSettings).where(eq(automationSettings.companyId, session.companyId)).limit(1);
  return NextResponse.json({ settings });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can edit automation settings" }, { status: 403 });
  }
  const body = await req.json();
  const allowed: Record<string, unknown> = {};
  for (const key of ["autoAssignEnabled", "assignmentMode", "autoRecycleEnabled", "recycleAfterMinutes"]) {
    if (key in body) allowed[key] = body[key];
  }

  const [updated] = await db
    .update(automationSettings)
    .set(allowed)
    .where(eq(automationSettings.companyId, session.companyId))
    .returning();

  return NextResponse.json({ settings: updated });
}
