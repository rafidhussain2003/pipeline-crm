import { NextRequest, NextResponse } from "next/server";
import { requireHome, getHomeSummary, setHomeBudget, toCents } from "@/lib/home";

// GET  → total budget, spent, left, and the expense list (newest first).
// PUT  → set/replace the total budget: { total: "150000" }.
export async function GET() {
  const auth = await requireHome();
  if (!auth.ok) return auth.response;
  return NextResponse.json(await getHomeSummary(auth.session.companyId));
}

export async function PUT(req: NextRequest) {
  const auth = await requireHome();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const totalCents = toCents(body?.total);
  if (totalCents === null) return NextResponse.json({ error: "Enter a valid budget amount." }, { status: 400 });
  await setHomeBudget(auth.session.companyId, auth.session.userId, totalCents);
  return NextResponse.json(await getHomeSummary(auth.session.companyId));
}
