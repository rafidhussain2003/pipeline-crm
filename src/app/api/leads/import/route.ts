import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { getSession } from "@/lib/auth";
import Papa from "papaparse";
import { assignLead } from "@/lib/assignment";
import { flagDuplicateLead } from "@/lib/duplicates";
import { recordAudit } from "@/lib/audit";
import { eventBus } from "@/lib/events/bus";
import { normalizeLeadInput, hasIdentifyingField } from "@/lib/leads/input";
import "@/lib/capi/listeners"; // lead.created -> Conversions API enqueue
import "@/lib/insights/listeners"; // lead.created -> insight recompute

type CsvRow = { name?: string; phone?: string; email?: string; Name?: string; Phone?: string; Email?: string };

// A CSV import runs inline in the request, one lead at a time (each row does an
// insert + duplicate flag + assignment). Past a few thousand rows that exceeds
// any sane request timeout and the caller gets a dead connection mid-import
// with no way to tell what landed. Cap it and tell them plainly.
const MAX_IMPORT_ROWS = 5000;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can import leads" }, { status: 403 });
  }

  const { csv } = await req.json();
  if (!csv) return NextResponse.json({ error: "csv text is required" }, { status: 400 });

  const parsed = Papa.parse<CsvRow>(csv, { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    return NextResponse.json({ error: `CSV parse error: ${parsed.errors[0].message}` }, { status: 400 });
  }
  if (parsed.data.length > MAX_IMPORT_ROWS) {
    return NextResponse.json(
      { error: `This file has ${parsed.data.length} rows. Please split it into files of ${MAX_IMPORT_ROWS} rows or fewer.` },
      { status: 413 },
    );
  }

  let created = 0;
  let duplicates = 0;
  let skipped = 0;

  for (const row of parsed.data) {
    // Same normalizer as every other entry point (coerce, trim, truncate).
    const input = normalizeLeadInput({ name: row.name ?? row.Name, phone: row.phone ?? row.Phone, email: row.email ?? row.Email });
    if (!hasIdentifyingField(input)) {
      skipped++;
      continue;
    }

    const [lead] = await db
      .insert(leads)
      .values({
        companyId: session.companyId,
        name: input.name || "Unknown",
        phone: input.phone,
        email: input.email,
        disposition: "New Lead",
      })
      .returning();

    // Flagged post-insert so rows within the SAME file dedup against each
    // other correctly (the pre-insert lookup missed same-file duplicates that
    // hadn't been committed yet when the next row was checked).
    const duplicateOfLeadId = await flagDuplicateLead(lead.id, session.companyId, input.phone, input.email);
    if (duplicateOfLeadId) duplicates++;

    // Parity with every other entry point — an imported lead is a created lead.
    await eventBus.emit("lead.created", { leadId: lead.id, companyId: session.companyId, source: "import" });

    try {
      await assignLead(lead.id, session.companyId);
    } catch (err) {
      // Lead was already created — don't let an assignment failure abort
      // the rest of the import. It's simply left unassigned.
      console.error(`Lead assignment failed during import (lead ${lead.id}):`, err);
    }
    created++;
  }

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "leads.imported",
    entityType: "lead",
    metadata: { created, duplicates, skipped },
  });

  return NextResponse.json({ created, duplicates, skipped });
}
