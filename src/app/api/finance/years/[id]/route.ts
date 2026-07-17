import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { setYearStatus } from "@/lib/finance";

// Open or close a financial year. Closing locks every entry date inside its
// range against posting and voiding.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinance("finance:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const status = body?.status;
  if (status !== "open" && status !== "closed") return NextResponse.json({ error: 'status must be "open" or "closed"' }, { status: 400 });
  try {
    const year = await setYearStatus(auth.session.companyId, auth.session.userId, id, status);
    return NextResponse.json({ year });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
