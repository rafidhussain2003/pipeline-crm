import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDeliveryLog } from "@/lib/capi";

// Conversions Delivery Log (paginated, filterable). Admin/manager only.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.companyId || (session.role !== "admin" && session.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const result = await getDeliveryLog(session.companyId, {
    page: parseInt(searchParams.get("page") || "1", 10),
    pixelConfigId: searchParams.get("pixelId") || undefined,
    status: searchParams.get("status") || undefined,
  });
  return NextResponse.json(result);
}
