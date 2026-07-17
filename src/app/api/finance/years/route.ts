import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { createYear, listYears } from "@/lib/finance";

export async function GET() {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  const years = await listYears(auth.session.companyId);
  return NextResponse.json({ years });
}

export async function POST(req: NextRequest) {
  const auth = await requireFinance("finance:manage");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    const year = await createYear(auth.session.companyId, auth.session.userId, {
      label: String(body?.label ?? ""),
      startDate: String(body?.startDate ?? ""),
      endDate: String(body?.endDate ?? ""),
    });
    return NextResponse.json({ year }, { status: 201 });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
