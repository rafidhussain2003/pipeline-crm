import { NextRequest, NextResponse } from "next/server";
import { requireLendingAdmin, lendingErrorResponse, cancelLoan, getLoan } from "@/lib/lending";
import { isUuid } from "@/lib/url";

// Cancel a loan with no EMI paid; the principal returns to the pool.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireLendingAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await cancelLoan(auth.session.companyId, auth.session.userId, id);
    return NextResponse.json(await getLoan(auth.session.companyId, id));
  } catch (err) {
    return lendingErrorResponse(err);
  }
}
