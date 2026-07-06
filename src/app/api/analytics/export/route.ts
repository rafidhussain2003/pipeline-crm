import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { requireCompanySession } from "@/lib/auth";
import { withRoute, timed } from "@/lib/api-handler";
import { checkPolicy } from "@/lib/rate-limit";
import { resolveDateRange, parseDateRangeKey } from "@/lib/analytics/range";
import type { DateRange } from "@/lib/analytics/types";
import { getConversionFunnel, getLeadsGroupedBy, type GroupByField } from "@/lib/analytics/service";

const REPORT_TYPES = ["leads-by-disposition", "leads-by-source", "leads-by-agent", "conversion"] as const;
type ReportType = (typeof REPORT_TYPES)[number];

const GROUP_BY_FOR_REPORT: Partial<Record<ReportType, GroupByField>> = {
  "leads-by-disposition": "disposition",
  "leads-by-source": "source",
  "leads-by-agent": "agent",
};

// CSV only for now — Excel (.xlsx) and PDF both need a new dependency
// (nothing in package.json produces either format today: no xlsx/exceljs,
// no pdfkit/puppeteer). Rather than quietly add one, this returns clean
// tabular JSON-shaped rows (the same `rows` array below feeds CSV today
// and would feed an Excel/PDF generator identically later) and flags the
// gap explicitly instead. This endpoint is for bounded, aggregated summary
// data (counts per disposition/source/agent — never more rows than there
// are categories), which is why it runs synchronously; the existing
// `/api/leads/export` route (raw per-lead data, potentially huge) is the
// one that should move to the job queue's `leads.export` type once queuing
// is real, not this one.
export async function GET(req: NextRequest) {
  return withRoute("analytics.export", "GET", req, async (logger) => {
    const auth = await requireCompanySession();
    if (!auth.ok) return auth.response;
    logger.setContext({ userId: auth.session.userId, companyId: auth.session.companyId });

    const rl = checkPolicy("api.authenticated", auth.session.userId);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") as ReportType | null;
    const format = searchParams.get("format") || "csv";

    if (!type || !REPORT_TYPES.includes(type)) {
      return NextResponse.json({ error: `type must be one of: ${REPORT_TYPES.join(", ")}` }, { status: 400 });
    }
    if (format !== "csv") {
      return NextResponse.json({ error: "Only format=csv is currently supported (Excel/PDF need a new dependency, not yet added)." }, { status: 400 });
    }

    const rangeKey = parseDateRangeKey(searchParams.get("range"));
    let range: DateRange;
    try {
      range = resolveDateRange(rangeKey, searchParams.get("from"), searchParams.get("to"));
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid date range" }, { status: 400 });
    }

    let rows: Record<string, string | number>[];
    if (type === "conversion") {
      const funnel = await timed(logger, "export_conversion", () => getConversionFunnel(auth.session.companyId, range));
      rows = funnel.stages.map((s) => ({ Disposition: s.label, Count: s.count }));
      rows.push({ Disposition: "TOTAL", Count: funnel.totalCount });
    } else {
      const groupBy = GROUP_BY_FOR_REPORT[type]!;
      const groups = await timed(logger, `export_${type}`, () => getLeadsGroupedBy(auth.session.companyId, range, groupBy));
      rows = groups.map((g) => ({ Group: g.label, Count: g.count }));
    }

    const csv = Papa.unparse(rows);
    logger.info("analytics_export", { type, rangeKey, rowCount: rows.length });

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${type}-${rangeKey}.csv"`,
      },
    });
  });
}
