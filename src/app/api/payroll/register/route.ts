import { NextRequest, NextResponse } from "next/server";
import { requirePayroll } from "@/lib/payroll/guard";
import { salaryRegister } from "@/lib/payroll";

// The searchable salary register (period / employee / status / net).
export async function GET(req: NextRequest) {
  const auth = await requirePayroll("payroll:view");
  if (!auth.ok) return auth.response;
  const p = req.nextUrl.searchParams;
  return NextResponse.json({
    rows: await salaryRegister(auth.session.companyId, {
      search: p.get("search") || undefined,
      status: p.get("status") || undefined,
      from: p.get("from") || undefined,
      to: p.get("to") || undefined,
      limit: Number(p.get("limit")) || 100,
      offset: Number(p.get("offset")) || 0,
    }),
  });
}
