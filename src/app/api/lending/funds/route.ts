import { NextRequest, NextResponse } from "next/server";
import { requireLendingAdmin, lendingErrorResponse, addFunds, getBankSummary, toPaise } from "@/lib/lending";

// Put money into the pool (initial balance or a top-up), or take some out.
// { amount: "50000", note?, date?, kind?: "deposit" | "withdrawal" }
export async function POST(req: NextRequest) {
  const auth = await requireLendingAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const amountCents = toPaise(body?.amount);
  if (amountCents === null) return NextResponse.json({ error: "Enter a valid amount" }, { status: 400 });
  try {
    await addFunds(auth.session.companyId, auth.session.userId, { amountCents, note: body?.note, occurredOn: body?.date, kind: body?.kind === "withdrawal" ? "withdrawal" : "deposit" });
    return NextResponse.json({ summary: await getBankSummary(auth.session.companyId, auth.session.userId) }, { status: 201 });
  } catch (err) {
    return lendingErrorResponse(err);
  }
}
