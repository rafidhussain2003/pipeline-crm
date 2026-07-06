import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { dispositionOptions } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { asc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(dispositionOptions)
    .where(eq(dispositionOptions.companyId, session.companyId))
    .orderBy(asc(dispositionOptions.sortOrder));

  return NextResponse.json({ dispositions: rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can edit disposition options" }, { status: 403 });
  }
  const { label, color } = await req.json();
  if (!label) return NextResponse.json({ error: "Label is required" }, { status: 400 });

  const [created] = await db
    .insert(dispositionOptions)
    .values({ companyId: session.companyId, label, color: color || "#2563eb", sortOrder: 999 })
    .returning();

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "disposition.created",
    entityType: "disposition_option",
    entityId: created.id,
    metadata: { label, color: created.color },
  });

  return NextResponse.json({ disposition: created });
}
