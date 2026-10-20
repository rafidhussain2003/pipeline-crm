import { NextRequest, NextResponse } from "next/server";
import { requireLendingAdmin, lendingErrorResponse, emailLoanDetails } from "@/lib/lending";
import { isUuid } from "@/lib/url";

// Re-send the loan details + EMI schedule to the borrower.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireLendingAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const res = await emailLoanDetails(auth.session.companyId, auth.session.userId, id);
    return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.reason || "Email could not be sent" }, { status: 502 });
  } catch (err) {
    return lendingErrorResponse(err);
  }
}
