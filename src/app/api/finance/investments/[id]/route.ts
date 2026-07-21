import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { updateInvestment } from "@/lib/finance";
import { isUuid } from "@/lib/url";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinance("finance:post");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    const investment = await updateInvestment(auth.session.companyId, auth.session.userId, id, {
      ...(body?.name !== undefined ? { name: String(body.name) } : {}),
      ...(body?.category !== undefined ? { category: body.category === null ? null : String(body.category) } : {}),
      ...(body?.currentValue !== undefined ? { currentValue: Number(body.currentValue) } : {}),
      ...(body?.notes !== undefined ? { notes: body.notes === null ? null : String(body.notes) } : {}),
    });
    return NextResponse.json({ investment });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
