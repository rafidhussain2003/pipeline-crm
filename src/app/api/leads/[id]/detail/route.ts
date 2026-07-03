import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq, isNull } from "drizzle-orm";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [lead] = await db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      state: leads.state,
      disposition: leads.disposition,
      ownerId: leads.ownerId,
      ownerName: users.name,
      followUpAt: leads.followUpAt,
      isDuplicate: leads.isDuplicate,
      duplicateOfLeadId: leads.duplicateOfLeadId,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .leftJoin(users, eq(leads.ownerId, users.id))
    .where(and(eq(leads.id, id), eq(leads.companyId, session.companyId), isNull(leads.deletedAt)))
    .limit(1);

  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ lead });
}
