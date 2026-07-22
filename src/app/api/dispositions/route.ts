import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { dispositionOptions } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, asc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { isUniqueViolation, isUndefinedColumn } from "@/lib/db-errors";
import { DISPOSITION_CATEGORIES, DEFAULT_DISPOSITIONS } from "@/lib/dispositions/taxonomy";

type DispositionRow = { id: string; companyId: string; label: string; color: string; sortOrder: number; category: string };

// Migration-lag-aware read. The full select includes the `category` column
// (migration 0037); against a database where that migration hasn't been
// applied yet, Postgres answers 42703 — fall back to the pre-0037 columns
// with everything under one bucket until the migrator catches the schema up.
async function loadDispositions(companyId: string): Promise<{ rows: DispositionRow[]; lagged: boolean }> {
  try {
    const rows = await db
      .select()
      .from(dispositionOptions)
      .where(eq(dispositionOptions.companyId, companyId))
      .orderBy(asc(dispositionOptions.sortOrder));
    return { rows, lagged: false };
  } catch (err) {
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
      .where(eq(dispositionOptions.companyId, companyId))
      .orderBy(asc(dispositionOptions.sortOrder));
    return { rows: rows.map((r) => ({ ...r, category: "OTHER" })), lagged: true };
  }
}

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const loaded = await loadDispositions(session.companyId);
  let rows = loaded.rows;
  const lagged = loaded.lagged;

  // Self-healing defaults: the platform taxonomy must exist for every
  // company even when the data migrations that backfill it haven't run
  // (their delivery has burned us repeatedly). Costs one Set comparison in
  // steady state; only when labels are actually missing does it insert them
  // — idempotent under the (company_id, label) unique index, and schema-lag
  // aware (no category column needed). Whoever loads the dropdown first
  // heals their company.
  const byLabel = new Map(rows.map((r) => [r.label, r]));
  const missing = DEFAULT_DISPOSITIONS.filter((d) => !byLabel.has(d.label));
  // Rows seeded BEFORE the category column existed sit in OTHER with the
  // right label but the wrong group — normalize taxonomy labels back to
  // their defined category/sort. Only meaningful when the real category
  // column is readable (not the lag fallback), and only for taxonomy labels
  // — admin-created customs are never touched.
  const misplaced = lagged
    ? []
    : DEFAULT_DISPOSITIONS.filter((d) => {
        const row = byLabel.get(d.label);
        return row !== undefined && (row.category !== d.category || row.sortOrder !== d.sortOrder);
      });

  if (missing.length > 0 || misplaced.length > 0) {
    try {
      if (missing.length > 0) {
        // id supplied explicitly — see POST: on long-lived databases this
        // table may lack a server-side uuid default, which made every heal
        // insert fail (and the catch below swallow it) forever.
        try {
          await db
            .insert(dispositionOptions)
            .values(missing.map((d) => ({ id: crypto.randomUUID(), companyId: session.companyId!, label: d.label, color: d.color, sortOrder: d.sortOrder, category: d.category })))
            .onConflictDoNothing();
        } catch (err) {
          if (!isUndefinedColumn(err)) throw err;
          await db
            .insert(dispositionOptions)
            .values(missing.map((d) => ({ id: crypto.randomUUID(), companyId: session.companyId!, label: d.label, color: d.color, sortOrder: d.sortOrder })))
            .onConflictDoNothing();
        }
      }
      for (const d of misplaced) {
        await db
          .update(dispositionOptions)
          .set({ category: d.category, sortOrder: d.sortOrder })
          .where(and(eq(dispositionOptions.companyId, session.companyId), eq(dispositionOptions.label, d.label)));
      }
      console.log(
        `[dispositions] healed defaults for company ${session.companyId} (seeded ${missing.length}, regrouped ${misplaced.length})`
      );
      ({ rows } = await loadDispositions(session.companyId));
    } catch (err) {
      // Serving what exists always beats a dead dropdown.
      console.error("[dispositions] could not heal defaults:", err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ dispositions: rows });
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
  // id supplied EXPLICITLY: this table predates the rest of the schema on
  // long-lived databases, and a missing server-side uuid default there makes
  // every insert fail while the whole rest of the app works — supplying the
  // id removes that dependency entirely.
  let created;
  try {
    [created] = await db
      .insert(dispositionOptions)
      .values({ id: crypto.randomUUID(), companyId: session.companyId, label: trimmed, color: color || "#2563eb", sortOrder: 999, category: requestedCategory || "OTHER" })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err, "disposition_options_company_label_uniq")) {
      return NextResponse.json({ error: `A disposition named "${trimmed}" already exists` }, { status: 409 });
    }
    // Migration lag (category ships in 0037): creating a disposition must
    // not be held hostage by a pending migration — retry the pre-0037 shape
    // (no category column; it groups under OTHER until the schema lands,
    // exactly like the GET fallback serves it). Loud log either way.
    if (!isUndefinedColumn(err)) {
      // The REAL reason, on screen — a masked "could not create" cost days
      // of blind debugging; the admin creating dispositions owns this
      // platform and gets the truth.
      const message = err instanceof Error ? err.message : String(err);
      console.error("[dispositions] create failed:", message);
      return NextResponse.json({ error: `Could not create the disposition — database said: ${message}` }, { status: 500 });
    }
    console.error("[dispositions] category column missing — migration 0037 not applied yet; creating without category");
    try {
      [created] = await db
        .insert(dispositionOptions)
        .values({ id: crypto.randomUUID(), companyId: session.companyId, label: trimmed, color: color || "#2563eb", sortOrder: 999 })
        .returning({
          id: dispositionOptions.id,
          companyId: dispositionOptions.companyId,
          label: dispositionOptions.label,
          color: dispositionOptions.color,
          sortOrder: dispositionOptions.sortOrder,
        });
    } catch (retryErr) {
      if (isUniqueViolation(retryErr, "disposition_options_company_label_uniq")) {
        return NextResponse.json({ error: `A disposition named "${trimmed}" already exists` }, { status: 409 });
      }
      const message = retryErr instanceof Error ? retryErr.message : String(retryErr);
      console.error("[dispositions] create failed (legacy shape):", message);
      return NextResponse.json({ error: `Could not create the disposition — database said: ${message}` }, { status: 500 });
    }
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
