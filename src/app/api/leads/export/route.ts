import { NextResponse } from "next/server";
import { db } from "@/db";
import { leads, users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { checkPolicy } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { WON_DISPOSITIONS } from "@/lib/dispositions/taxonomy";
import { and, desc, eq, isNull, notInArray } from "drizzle-orm";

// Smart lead export — an Excel sheet of the company's leads that AUTOMATICALLY
// EXCLUDES every sold / closed lead. Bulk-exported leads get sent on or sold
// in bulk, and once they are in a spreadsheet nobody can tell a sold lead
// from an open one — so a customer who already bought from us could be
// re-sold, causing order cancellations and a security problem for the
// business. Excluding them AT THE DATABASE (never in the file) makes that
// impossible: a sold lead simply never leaves the system.
//
// "Sold" = the taxonomy's WON_DISPOSITIONS ("Sale Closed", "Installation
// Scheduled", "Sold") — the same single source of truth the pipeline and
// analytics use, so what counts as sold can never drift.
//
// ADMIN ONLY. Managers, agents and distributors all get 403 — an export is
// the whole customer database in one file, the prime data-theft vector, and
// the owner has decided only the admin may produce it.
export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (session.role !== "admin") {
    return NextResponse.json({ error: "Only an admin can export leads." }, { status: 403 });
  }

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const rows = await db
    .select({
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      state: leads.state,
      disposition: leads.disposition,
      owner: users.name,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .leftJoin(users, eq(leads.ownerId, users.id))
    .where(
      and(
        eq(leads.companyId, session.companyId),
        isNull(leads.deletedAt),
        // The smart part: sold / closed leads never make it into the file.
        notInArray(leads.disposition, WON_DISPOSITIONS)
      )
    )
    .orderBy(desc(leads.createdAt));

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "leads.exported",
    entityType: "lead",
    metadata: { format: "xls", count: rows.length, excludedDispositions: WON_DISPOSITIONS },
  });

  // Excel-native .xls: an HTML table Excel opens as a formatted sheet (bold
  // header row, borders) — the same dependency-free approach the Sales Ledger
  // export uses. Cells are HTML-escaped; phone numbers are emitted as text so
  // Excel doesn't mangle "+1…" into a formula/number.
  const esc = (v: unknown) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const HEADERS = ["Name", "Phone", "Email", "State", "Disposition", "Owner", "Created At"];
  const fmtDate = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
  const body =
    `<html><head><meta charset="utf-8"></head><body>` +
    `<table border="1"><thead><tr style="background:#f1f5f9;font-weight:bold">` +
    HEADERS.map((h) => `<th>${esc(h)}</th>`).join("") +
    `</tr></thead><tbody>` +
    rows
      .map(
        (r) =>
          `<tr>` +
          `<td>${esc(r.name)}</td>` +
          `<td style="mso-number-format:'\\@'">${esc(r.phone)}</td>` +
          `<td>${esc(r.email)}</td>` +
          `<td>${esc(r.state)}</td>` +
          `<td>${esc(r.disposition)}</td>` +
          `<td>${esc(r.owner || "Unassigned")}</td>` +
          `<td>${esc(fmtDate(r.createdAt))}</td>` +
          `</tr>`
      )
      .join("") +
    `</tbody></table></body></html>`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-export-${new Date().toISOString().slice(0, 10)}.xls"`,
      "Cache-Control": "no-store",
    },
  });
}
