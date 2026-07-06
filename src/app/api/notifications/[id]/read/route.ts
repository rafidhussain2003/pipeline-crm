import { NextRequest, NextResponse } from "next/server";
import { requireCompanySession } from "@/lib/auth";
import { withRoute } from "@/lib/api-handler";
import { markNotificationRead } from "@/lib/notifications/service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute("notifications.read", "POST", req, async (logger) => {
    const auth = await requireCompanySession();
    if (!auth.ok) return auth.response;
    logger.setContext({ userId: auth.session.userId, companyId: auth.session.companyId });

    const { id } = await params;
    const updated = await markNotificationRead(id, auth.session.userId);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ notification: updated });
  });
}
