import { NextRequest, NextResponse } from "next/server";
import { requireLendingAdmin, lendingErrorResponse, markEmiPaid, unmarkEmiPaid, getLoan } from "@/lib/lending";
import { isUuid } from "@/lib/url";

// POST   { paidOn?, note?, sendEmail? } → mark this EMI paid (receipt emailed)
// DELETE                                → undo a paid mark
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; emiId: string }> }) {
  const auth = await requireLendingAdmin();
  if (!auth.ok) return auth.response;
  const { id, emiId } = await params;
  if (!isUuid(id) || !isUuid(emiId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    const result = await markEmiPaid(auth.session.companyId, auth.session.userId, id, emiId, { paidOn: body?.paidOn, note: body?.note, sendEmail: body?.sendEmail !== false });
    return NextResponse.json({ ...result, ...(await getLoan(auth.session.companyId, id)) });
  } catch (err) {
    return lendingErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; emiId: string }> }) {
  const auth = await requireLendingAdmin();
  if (!auth.ok) return auth.response;
  const { id, emiId } = await params;
  if (!isUuid(id) || !isUuid(emiId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await unmarkEmiPaid(auth.session.companyId, auth.session.userId, id, emiId);
    return NextResponse.json(await getLoan(auth.session.companyId, id));
  } catch (err) {
    return lendingErrorResponse(err);
  }
}
