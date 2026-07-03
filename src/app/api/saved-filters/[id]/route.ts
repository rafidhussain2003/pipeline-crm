import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { savedFilters } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq } from "drizzle-orm";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  await db.delete(savedFilters).where(and(eq(savedFilters.id, id), eq(savedFilters.userId, session.userId)));
  return NextResponse.json({ ok: true });
}
