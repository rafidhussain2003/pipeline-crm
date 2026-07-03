import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { assignLead } from "@/lib/assignment";
import { findDuplicateLead } from "@/lib/duplicates";
import { recordAudit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim();
  const disposition = searchParams.get("disposition");
  const ownerId = searchParams.get("ownerId");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = 50;

  const conditions = [eq(leads.companyId, session.companyId), isNull(leads.deletedAt)];
  if (disposition) conditions.push(eq(leads.disposition, disposition));
  if (ownerId) conditions.push(eq(leads.ownerId, ownerId));
  if (search) {
    const searchCond = or(
      ilike(leads.name, `%${search}%`),
      ilike(leads.phone, `%${search}%`),
      ilike(leads.email, `%${search}%`)
    );
    if (searchCond) conditions.push(searchCond);
  }

  const rows = await db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      disposition: leads.disposition,
      followUpAt: leads.followUpAt,
      createdAt: leads.createdAt,
      ownerId: leads.ownerId,
      ownerName: users.name,
      isDuplicate: leads.isDuplicate,
    })
    .from(leads)
    .leftJoin(users, eq(leads.ownerId, users.id))
    .where(and(...conditions))
    .orderBy(desc(leads.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ leads: rows, page, pageSize });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();

  const duplicateOfLeadId = await findDuplicateLead(session.companyId, body.phone, body.email);

  const [lead] = await db
    .insert(leads)
    .values({
      companyId: session.companyId,
      name: body.name,
      phone: body.phone,
      email: body.email,
      disposition: body.disposition || "New Lead",
      isDuplicate: !!duplicateOfLeadId,
      duplicateOfLeadId,
    })
    .returning();

  await assignLead(lead.id, session.companyId);
  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "lead.created",
    entityType: "lead",
    entityId: lead.id,
    metadata: { source: "manual", isDuplicate: !!duplicateOfLeadId },
  });

  return NextResponse.json({ lead });
}
