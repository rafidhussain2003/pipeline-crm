import { NextRequest, NextResponse } from "next/server";
import { requirePayroll, payrollErrorResponse } from "@/lib/payroll/guard";
import { listProfiles, upsertProfile } from "@/lib/payroll";

export async function GET() {
  const auth = await requirePayroll("payroll:view");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ employees: await listProfiles(auth.session.companyId) });
}

// Create/update an employee's payroll profile: { userId, structureId?, ... }
export async function PUT(req: NextRequest) {
  const auth = await requirePayroll("payroll:manage");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  if (!body?.userId || typeof body.userId !== "string") return NextResponse.json({ error: "userId is required" }, { status: 400 });
  try {
    const profile = await upsertProfile(auth.session.companyId, auth.session.userId, body.userId, {
      structureId: body.structureId !== undefined ? body.structureId || null : undefined,
      frequency: typeof body.frequency === "string" ? body.frequency : undefined,
      joiningDate: body.joiningDate !== undefined ? body.joiningDate || null : undefined,
      status: typeof body.status === "string" ? body.status : undefined,
      bankAccountRef: body.bankAccountRef !== undefined ? body.bankAccountRef || null : undefined,
      taxRef: body.taxRef !== undefined ? body.taxRef || null : undefined,
      notes: body.notes !== undefined ? body.notes || null : undefined,
    });
    return NextResponse.json({ profile });
  } catch (err) {
    return payrollErrorResponse(err);
  }
}
