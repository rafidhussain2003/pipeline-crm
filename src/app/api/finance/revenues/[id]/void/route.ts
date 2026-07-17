import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { voidRevenue } from "@/lib/finance";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinance("finance:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const revenue = await voidRevenue(auth.session.companyId, auth.session.userId, id, typeof body?.reason === "string" ? body.reason : undefined);
    return NextResponse.json({ revenue });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
