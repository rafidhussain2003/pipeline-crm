import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { dispositionOptions } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { asc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { isUniqueViolation } from "@/lib/db-errors";

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
  const trimmed = typeof label === "string" ? label.trim() : "";
  if (!trimmed) return NextResponse.json({ error: "Label is required" }, { status: 400 });

  // Leads store their disposition as this LABEL, so two options sharing one
  // would be indistinguishable on a lead and would split every pipeline count.
  // The (company_id, label) unique index enforces it; translate the violation
  // into a 409 rather than letting it surface as a 500.
  let created;
  try {
    [created] = await db
      .insert(dispositionOptions)
      .values({ companyId: session.companyId, label: trimmed, color: color || "#2563eb", sortOrder: 999 })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err, "disposition_options_company_label_uniq")) {
      return NextResponse.json({ error: `A disposition named "${trimmed}" already exists` }, { status: 409 });
    }
    throw err;
  }

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "disposition.created",
    entityType: "disposition_option",
    entityId: created.id,
    metadata: { label: trimmed, color: created.color },
  });

  return NextResponse.json({ disposition: created });
}
