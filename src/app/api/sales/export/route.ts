import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sales, users } from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { requireSales, resolveSalesScope, currentSaleMonth } from "@/lib/sales/access";
import { isValidSaleMonth } from "@/lib/sales/types";

const HEADERS = ["Order Date", "Installation Date", "Customer Name", "Phone", "Product", "Account #", "Autopay", "Activation Status", "Notes", "Agent"];
// Same palette as the on-screen rows, so the exported Excel sheet looks familiar.
const ROW_BG: Record<string, string> = { active: "#dcfce7", pending: "#ffedd5", cancelled: "#fee2e2", follow_up: "#fef9c3" };

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const htmlCell = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Export a month's sheet as CSV (opens in Excel) or an Excel-native .xls (an
// HTML table Excel renders as a formatted, color-coded sheet). No dependency
// added. Admin/manager only (the export permission), tenant-scoped.
export async function GET(req: NextRequest) {
  const auth = await requireSales();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const scope = await resolveSalesScope(session, currentSaleMonth());
  if (!scope.canExport) return NextResponse.json({ error: "You do not have permission to export." }, { status: 403 });

  const p = req.nextUrl.searchParams;
  const month = isValidSaleMonth(p.get("month")) ? p.get("month")! : currentSaleMonth();
  const format = p.get("format") === "xls" ? "xls" : "csv";

  const rows = await db
    .select({
      orderDate: sales.orderDate,
      installationDate: sales.installationDate,
      customerName: sales.customerName,
      phone: sales.phone,
      product: sales.product,
      accountNumber: sales.accountNumber,
      autopay: sales.autopay,
      activationStatus: sales.activationStatus,
      notes: sales.notes,
      agentName: users.name,
    })
    .from(sales)
    .leftJoin(users, eq(users.id, sales.agentId))
    .where(and(eq(sales.companyId, session.companyId), eq(sales.saleMonth, month), isNull(sales.deletedAt)))
    .orderBy(asc(sales.createdAt))
    .limit(100_000);

  const cells = (r: (typeof rows)[number]) => [
    r.orderDate,
    r.installationDate,
    r.customerName,
    r.phone,
    r.product,
    r.accountNumber,
    r.autopay ? "Yes" : "No",
    r.activationStatus,
    r.notes,
    r.agentName,
  ];

  if (format === "xls") {
    const body =
      `<html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>` +
      HEADERS.map((h) => `<th>${htmlCell(h)}</th>`).join("") +
      `</tr></thead><tbody>` +
      rows
        .map((r) => {
          const bg = ROW_BG[r.activationStatus] || "#ffffff";
          return `<tr style="background:${bg}">` + cells(r).map((c) => `<td>${htmlCell(c)}</td>`).join("") + `</tr>`;
        })
        .join("") +
      `</tbody></table></body></html>`;
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="sales-${month}.xls"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const csv = [HEADERS.map(csvCell).join(","), ...rows.map((r) => cells(r).map(csvCell).join(","))].join("\r\n");
  // Leading BOM so Excel opens the CSV as UTF-8 (non-ASCII names render right).
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales-${month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
