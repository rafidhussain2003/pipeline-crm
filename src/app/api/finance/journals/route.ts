import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { createDraft, listJournals } from "@/lib/finance";

export async function GET(req: NextRequest) {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  const p = req.nextUrl.searchParams;
  const rawStatus = p.get("status");
  const status = rawStatus === "draft" || rawStatus === "posted" || rawStatus === "voided" ? rawStatus : undefined;
  const journals = await listJournals(auth.session.companyId, {
    status,
    limit: Number(p.get("limit")) || 50,
    offset: Number(p.get("offset")) || 0,
  });
  return NextResponse.json({ journals });
}

// Create a DRAFT manual journal entry (posting is an explicit second action).
export async function POST(req: NextRequest) {
  const auth = await requireFinance("finance:post");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    const journal = await createDraft(auth.session.companyId, auth.session.userId, {
      entryDate: String(body?.entryDate ?? ""),
      memo: typeof body?.memo === "string" ? body.memo : null,
      lines: Array.isArray(body?.lines) ? body.lines : [],
    });
    return NextResponse.json({ journal }, { status: 201 });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
