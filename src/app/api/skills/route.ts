import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { skills, userSkills } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.select().from(skills).where(eq(skills.companyId, session.companyId));
  return NextResponse.json({ skills: rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can add skills" }, { status: 403 });
  }
  const { label } = await req.json();
  if (!label) return NextResponse.json({ error: "Label is required" }, { status: 400 });

  const [skill] = await db.insert(skills).values({ companyId: session.companyId, label }).returning();
  return NextResponse.json({ skill });
}
