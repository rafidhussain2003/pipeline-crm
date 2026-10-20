import { NextRequest, NextResponse } from "next/server";
import { requireLendingAdmin, getLoan } from "@/lib/lending";
import { isUuid } from "@/lib/url";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireLendingAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const data = isUuid(id) ? await getLoan(auth.session.companyId, id) : null;
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}
