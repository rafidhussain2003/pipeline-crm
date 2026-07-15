import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDiagnostics } from "@/lib/capi";

// Meta Diagnostics: pixel/dataset/OAuth status, permissions, recent events,
// success/failure rate, average latency, Event Match Quality. Admin/manager only.
export async function GET() {
  const session = await getSession();
  if (!session?.companyId || (session.role !== "admin" && session.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const diagnostics = await getDiagnostics(session.companyId);
  return NextResponse.json({ diagnostics });
}
