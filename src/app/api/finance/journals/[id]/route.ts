import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { deleteDraft, getJournal, postJournal, updateDraft, voidJournal, guardOpeningVoid } from "@/lib/finance";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const journal = await getJournal(auth.session.companyId, id);
  if (!journal) return NextResponse.json({ error: "Journal entry not found" }, { status: 404 });
  return NextResponse.json({ journal });
}

// Edit a DRAFT (posted/voided entries are immutable — the service enforces it).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinance("finance:post");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const journal = await updateDraft(auth.session.companyId, auth.session.userId, id, {
      entryDate: typeof body?.entryDate === "string" ? body.entryDate : undefined,
      memo: body?.memo !== undefined ? body.memo : undefined,
      lines: Array.isArray(body?.lines) ? body.lines : undefined,
    });
    return NextResponse.json({ journal });
  } catch (err) {
    return financeErrorResponse(err);
  }
}

// Actions: { action: "post" } | { action: "void", reason? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  try {
    if (action === "post") {
      const auth = await requireFinance("finance:post");
      if (!auth.ok) return auth.response;
      const journal = await postJournal(auth.session.companyId, auth.session.userId, id);
      return NextResponse.json({ journal });
    }
    if (action === "void") {
      // Voiding rewrites nothing but is a correction power — manage only.
      const auth = await requireFinance("finance:manage");
      if (!auth.ok) return auth.response;
      await guardOpeningVoid(auth.session.companyId, id);
      const result = await voidJournal(auth.session.companyId, auth.session.userId, id, typeof body?.reason === "string" ? body.reason : undefined);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: 'action must be "post" or "void"' }, { status: 400 });
  } catch (err) {
    return financeErrorResponse(err);
  }
}

// Discard a DRAFT (never a posted entry).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinance("finance:post");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    await deleteDraft(auth.session.companyId, auth.session.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
