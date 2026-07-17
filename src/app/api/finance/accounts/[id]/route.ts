import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { updateAccount, deleteAccount } from "@/lib/finance";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinance("finance:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const account = await updateAccount(auth.session.companyId, auth.session.userId, id, {
      name: typeof body?.name === "string" ? body.name : undefined,
      description: body?.description !== undefined ? body.description : undefined,
      active: typeof body?.active === "boolean" ? body.active : undefined,
      parentId: body?.parentId !== undefined ? body.parentId || null : undefined,
      metadata: body?.metadata !== undefined ? body.metadata : undefined,
    });
    return NextResponse.json({ account });
  } catch (err) {
    return financeErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinance("finance:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    await deleteAccount(auth.session.companyId, auth.session.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
