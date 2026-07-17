import { NextRequest, NextResponse } from "next/server";
import { requirePayroll, payrollErrorResponse } from "@/lib/payroll/guard";
import { moneyToCents, reviseStructure, structureHistory } from "@/lib/payroll";

// The full version history of a structure lineage.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePayroll("payroll:view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    return NextResponse.json({ versions: await structureHistory(auth.session.companyId, id) });
  } catch (err) {
    return payrollErrorResponse(err);
  }
}

function toComponentCents(raw: unknown): unknown {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    const o = c as { amount?: number; amountCents?: number };
    return { ...o, amountCents: o.amountCents !== undefined ? o.amountCents : moneyToCents(o.amount ?? 0) };
  });
}

// Editing a structure creates a new version (see reviseStructure).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePayroll("payroll:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const structure = await reviseStructure(auth.session.companyId, auth.session.userId, id, {
      name: String(body?.name ?? ""),
      frequency: String(body?.frequency ?? "monthly"),
      basicCents: body?.basicCents !== undefined ? Number(body.basicCents) : moneyToCents(body?.basic ?? 0),
      components: toComponentCents(body?.components),
    });
    return NextResponse.json({ structure });
  } catch (err) {
    return payrollErrorResponse(err);
  }
}
