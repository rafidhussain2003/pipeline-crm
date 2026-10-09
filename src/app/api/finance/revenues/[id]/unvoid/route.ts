import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { unvoidRevenue } from "@/lib/finance";
import { isUuid } from "@/lib/url";

// Reinstate a voided revenue entry (same gate as voiding). Posts a fresh
// journal with the original lines on the original date; see unvoidRevenue.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinance("finance:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    const revenue = await unvoidRevenue(auth.session.companyId, auth.session.userId, id, typeof body?.reason === "string" ? body.reason : undefined);
    return NextResponse.json({ revenue });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
