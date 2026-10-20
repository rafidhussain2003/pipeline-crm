import { NextRequest, NextResponse } from "next/server";
import { requireLendingAdmin, lendingErrorResponse, createLoan, toPaise } from "@/lib/lending";
import { buildSchedule, firstDueDateAfter } from "@/lib/lending/emi";

// GET ?amount=&rate=&months=&start=  → EMI preview (no write)
export async function GET(req: NextRequest) {
  const auth = await requireLendingAdmin();
  if (!auth.ok) return auth.response;
  const p = req.nextUrl.searchParams;
  const principal = toPaise(p.get("amount")) ?? 0;
  const rate = Number(p.get("rate") ?? 14);
  const months = Math.min(12, Math.max(1, Math.floor(Number(p.get("months") ?? 12))));
  const start = /^\d{4}-\d{2}-\d{2}$/.test(p.get("start") || "") ? (p.get("start") as string) : new Date().toISOString().slice(0, 10);
  if (principal <= 0 || !Number.isFinite(rate)) return NextResponse.json({ error: "Enter an amount" }, { status: 400 });
  return NextResponse.json(buildSchedule(principal, rate, months, firstDueDateAfter(start)));
}

// POST → disburse a loan, build its EMI schedule, email the borrower.
export async function POST(req: NextRequest) {
  const auth = await requireLendingAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const principalCents = toPaise(body?.amount);
  if (principalCents === null) return NextResponse.json({ error: "Enter a valid loan amount" }, { status: 400 });
  try {
    const result = await createLoan(auth.session.companyId, auth.session.userId, {
      borrowerName: String(body?.borrowerName ?? ""),
      borrowerPhone: String(body?.borrowerPhone ?? ""),
      borrowerEmail: String(body?.borrowerEmail ?? ""),
      principalCents,
      interestRate: body?.interestRate === undefined || body?.interestRate === null || body?.interestRate === "" ? null : Number(body.interestRate),
      tenureMonths: Number(body?.tenureMonths),
      startDate: typeof body?.startDate === "string" ? body.startDate : null,
      notes: typeof body?.notes === "string" ? body.notes : null,
      sendEmail: body?.sendEmail !== false,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return lendingErrorResponse(err);
  }
}
