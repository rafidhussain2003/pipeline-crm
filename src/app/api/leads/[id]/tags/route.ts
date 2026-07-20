import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadTags } from "@/db/schema";
import { getSession, type CompanySession } from "@/lib/auth";
import { canAccessLead } from "@/lib/leads/access";
import { and, eq } from "drizzle-orm";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  // Agent Portal: agents reach only their own leads (see lib/leads/access).
  if (!(await canAccessLead(session as CompanySession, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db.select().from(leadTags).where(eq(leadTags.leadId, id));
  return NextResponse.json({ tagIds: rows.map((r) => r.tagId) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { tagId } = await req.json();
  if (!tagId) return NextResponse.json({ error: "tagId is required" }, { status: 400 });

  // Agent Portal: agents reach only their own leads (see lib/leads/access).
  if (!(await canAccessLead(session as CompanySession, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.insert(leadTags).values({ leadId: id, tagId }).onConflictDoNothing();
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const tagId = searchParams.get("tagId");
  if (!tagId) return NextResponse.json({ error: "tagId is required" }, { status: 400 });

  // Agent Portal: agents reach only their own leads (see lib/leads/access).
  if (!(await canAccessLead(session as CompanySession, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.delete(leadTags).where(and(eq(leadTags.leadId, id), eq(leadTags.tagId, tagId)));
  return NextResponse.json({ ok: true });
}
