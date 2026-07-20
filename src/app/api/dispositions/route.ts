import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { dispositionOptions } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { asc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { isUniqueViolation, isUndefinedColumn } from "@/lib/db-errors";
import { DISPOSITION_CATEGORIES } from "@/lib/dispositions/taxonomy";

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const rows = await db
      .select()
      .from(dispositionOptions)
      .where(eq(dispositionOptions.companyId, session.companyId))
      .orderBy(asc(dispositionOptions.sortOrder));
    return NextResponse.json({ dispositions: rows });
  } catch (err) {
    // Migration lag guard. This select includes the `category` column
    // (migration 0037); against a database where that migration hasn't been
    // applied yet, Postgres answers 42703 and this route used to 500 — which
    // blanked every disposition dropdown in the CRM (the page treats a
    // failed fetch as "no options"). Agents being unable to record call
    // outcomes is far worse than briefly ungrouped options, so fall back to
    // the pre-0037 columns with everything under one bucket until the boot
    // migrator (src/instrumentation.ts) catches the schema up.
    if (!isUndefinedColumn(err)) throw err;
    console.error("[dispositions] category column missing — migration 0037 not applied yet; serving legacy shape");
    const rows = await db
      .select({
        id: dispositionOptions.id,
        companyId: dispositionOptions.companyId,
        label: dispositionOptions.label,
        color: dispositionOptions.color,
        sortOrder: dispositionOptions.sortOrder,
      })
      .from(dispositionOptions)
      .where(eq(dispositionOptions.companyId, session.companyId))
      .orderBy(asc(dispositionOptions.sortOrder));
    return NextResponse.json({ dispositions: rows.map((r) => ({ ...r, category: "OTHER" })) });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can edit disposition options" }, { status: 403 });
  }
  const { label, color, category } = await req.json();
  const trimmed = typeof label === "string" ? label.trim() : "";
  if (!trimmed) return NextResponse.json({ error: "Label is required" }, { status: 400 });
  // Category is display grouping only (see taxonomy.ts) — unknown values are
  // rejected rather than silently stored so the grouped select stays coherent.
  const requestedCategory =
    typeof category === "string" && (DISPOSITION_CATEGORIES as readonly string[]).includes(category) ? category : undefined;
  if (category !== undefined && !requestedCategory) {
    return NextResponse.json({ error: `Category must be one of: ${DISPOSITION_CATEGORIES.join(", ")}` }, { status: 400 });
  }

  // Leads store their disposition as this LABEL, so two options sharing one
  // would be indistinguishable on a lead and would split every pipeline count.
  // The (company_id, label) unique index enforces it; translate the violation
  // into a 409 rather than letting it surface as a 500.
  let created;
  try {
    [created] = await db
      .insert(dispositionOptions)
      .values({ companyId: session.companyId, label: trimmed, color: color || "#2563eb", sortOrder: 999, category: requestedCategory || "OTHER" })
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
