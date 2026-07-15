import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getOperationsSnapshot, ensureActivityListeners, activityHub } from "@/lib/operations";

// One-shot operational snapshot for the company. Admins + managers only (the
// two operational roles); everyone else 403. Also used as the non-SSE fallback
// and by tests. Cheap: the snapshot is cached 5s.
export async function GET() {
  const session = await getSession();
  if (!session?.companyId || (session.role !== "admin" && session.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  ensureActivityListeners();
  const snapshot = await getOperationsSnapshot(session.companyId);
  return NextResponse.json({ snapshot, activity: activityHub.getRecent(session.companyId, 50) });
}
