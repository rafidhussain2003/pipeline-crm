import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { savedFilters } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(savedFilters)
    .where(and(eq(savedFilters.companyId, session.companyId), eq(savedFilters.userId, session.userId)));

  return NextResponse.json({ filters: rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, filterJson } = await req.json();
  if (!name || !filterJson) return NextResponse.json({ error: "name and filterJson are required" }, { status: 400 });

  const [filter] = await db
    .insert(savedFilters)
    .values({ companyId: session.companyId, userId: session.userId, name, filterJson })
    .returning();

  return NextResponse.json({ filter });
}
