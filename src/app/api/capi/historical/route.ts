import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { resendHistorical } from "@/lib/capi";

// Resend historical conversions (last 7 / 30 days / custom range). Deduplicated
// by the (pixel, event_id) unique index, so already-sent conversions are
// skipped. Admin/manager only.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.companyId || (session.role !== "admin" && session.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));

  let fromMs: number;
  let toMs = Date.now();
  if (body?.range === "7d") fromMs = Date.now() - 7 * 86_400_000;
  else if (body?.range === "30d") fromMs = Date.now() - 30 * 86_400_000;
  else if (body?.from) {
    fromMs = Date.parse(body.from);
    if (body?.to) toMs = Date.parse(body.to);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  } else {
    return NextResponse.json({ error: "Provide range (7d|30d) or from/to dates" }, { status: 400 });
  }

  const result = await resendHistorical(session.companyId, { fromMs, toMs });
  await recordAudit({ companyId: session.companyId, userId: session.userId, action: "capi.historical_resend", entityType: "company", entityId: session.companyId, after: result });
  return NextResponse.json(result);
}
