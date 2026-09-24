import { NextRequest, NextResponse } from "next/server";
import { requireHome, getHomeSummary, addHomeExpense, toCents } from "@/lib/home";

// POST → add an expense spent from the home budget:
//        { amount: "2500", note: "Cement, 50 bags", spentOn: "2026-09-24" }
export async function POST(req: NextRequest) {
  const auth = await requireHome();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const amountCents = toCents(body?.amount);
  if (amountCents === null || amountCents === 0) return NextResponse.json({ error: "Enter a valid amount." }, { status: 400 });
  const note = String(body?.note ?? "").trim().slice(0, 500);
  if (!note) return NextResponse.json({ error: "Add a note saying where it was spent." }, { status: 400 });
  const spentOn = String(body?.spentOn ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn) || Number.isNaN(Date.parse(spentOn))) {
    return NextResponse.json({ error: "Enter a valid date." }, { status: 400 });
  }
  await addHomeExpense(auth.session.companyId, auth.session.userId, { amountCents, note, spentOn });
  return NextResponse.json(await getHomeSummary(auth.session.companyId), { status: 201 });
}
