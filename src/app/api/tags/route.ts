import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tags } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.select().from(tags).where(eq(tags.companyId, session.companyId));
  return NextResponse.json({ tags: rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { label, color } = await req.json();
  if (!label) return NextResponse.json({ error: "Label is required" }, { status: 400 });

  const [tag] = await db.insert(tags).values({ companyId: session.companyId, label, color: color || "#64748b" }).returning();
  return NextResponse.json({ tag });
}
