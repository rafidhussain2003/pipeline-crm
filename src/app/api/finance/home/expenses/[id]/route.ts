import { NextRequest, NextResponse } from "next/server";
import { requireHome, getHomeSummary, removeHomeExpense } from "@/lib/home";
import { isUuid } from "@/lib/url";

// DELETE → remove an expense (soft delete); its amount returns to budget left.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHome();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const removed = await removeHomeExpense(auth.session.companyId, id);
  if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await getHomeSummary(auth.session.companyId));
}
