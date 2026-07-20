import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, users } from "@/db/schema";
import { getSession, type CompanySession } from "@/lib/auth";
import { leadVisibilityConditions } from "@/lib/leads/access";
import { isUuid } from "@/lib/url";
import { and, eq, isNull } from "drizzle-orm";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  // A malformed id would otherwise reach a uuid column and surface as an
  // empty-bodied 500; treat it as the missing record it describes.
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
      priority: leads.priority,
      isBlacklisted: leads.isBlacklisted,
      isDuplicate: leads.isDuplicate,
      duplicateOfLeadId: leads.duplicateOfLeadId,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .leftJoin(users, eq(leads.ownerId, users.id))
    // Agent Portal: leadVisibilityConditions scopes agents to their own
    // leads — another agent's lead 404s exactly like a nonexistent one.
    .where(and(eq(leads.id, id), ...leadVisibilityConditions(session as CompanySession), isNull(leads.deletedAt)))
    .limit(1);

  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ lead });
}
