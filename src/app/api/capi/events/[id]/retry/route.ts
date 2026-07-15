import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { retryCapiEvent } from "@/lib/capi";

// Manual retry of a failed / dead-lettered conversion event. Company-scoped
// (retryCapiEvent only touches rows for this company). Admin/manager only.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.companyId || (session.role !== "admin" && session.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const ok = await retryCapiEvent(id, session.companyId);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
