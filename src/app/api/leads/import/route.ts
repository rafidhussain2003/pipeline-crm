import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { getSession } from "@/lib/auth";
import Papa from "papaparse";
import { assignLead } from "@/lib/assignment";
import { findDuplicateLead } from "@/lib/duplicates";
import { recordAudit } from "@/lib/audit";

type CsvRow = { name?: string; phone?: string; email?: string; Name?: string; Phone?: string; Email?: string };

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

  let created = 0;
  let duplicates = 0;
  let skipped = 0;

  for (const row of parsed.data) {
    const name = row.name || row.Name;
    const phone = row.phone || row.Phone;
    const email = row.email || row.Email;

    if (!name && !phone && !email) {
      skipped++;
      continue;
    }

    const duplicateOfLeadId = await findDuplicateLead(session.companyId, phone, email);
    if (duplicateOfLeadId) duplicates++;

    const [lead] = await db
      .insert(leads)
      .values({
        companyId: session.companyId,
        name: name || "Unknown",
        phone,
        email,
        disposition: "New Lead",
        isDuplicate: !!duplicateOfLeadId,
        duplicateOfLeadId,
      })
      .returning();

    await assignLead(lead.id, session.companyId);
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
