import { NextRequest, NextResponse } from "next/server";
import { requirePayroll, payrollErrorResponse } from "@/lib/payroll/guard";
import { createStructure, listStructures } from "@/lib/payroll";
import { moneyToCents } from "@/lib/payroll";

export async function GET() {
  const auth = await requirePayroll("payroll:view");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ structures: await listStructures(auth.session.companyId) });
}

// Component amounts arrive in dollars; convert to cents at the boundary.
function toComponentCents(raw: unknown): unknown {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    const o = c as { amount?: number; amountCents?: number };
    return { ...o, amountCents: o.amountCents !== undefined ? o.amountCents : moneyToCents(o.amount ?? 0) };
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePayroll("payroll:manage");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    const structure = await createStructure(auth.session.companyId, auth.session.userId, {
      name: String(body?.name ?? ""),
      frequency: String(body?.frequency ?? "monthly"),
      basicCents: body?.basicCents !== undefined ? Number(body.basicCents) : moneyToCents(body?.basic ?? 0),
      components: toComponentCents(body?.components),
    });
    return NextResponse.json({ structure }, { status: 201 });
  } catch (err) {
    return payrollErrorResponse(err);
  }
}
