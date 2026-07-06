import { NextRequest, NextResponse } from "next/server";
import { requireCompanySession } from "@/lib/auth";
import { withRoute } from "@/lib/api-handler";
import { getNotificationsForUser } from "@/lib/notifications/service";

export async function GET(req: NextRequest) {
  return withRoute("notifications", "GET", req, async (logger) => {
    const auth = await requireCompanySession();
    if (!auth.ok) return auth.response;
    logger.setContext({ userId: auth.session.userId, companyId: auth.session.companyId });

    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get("unreadOnly") === "true";

    const items = await getNotificationsForUser(auth.session.userId, { unreadOnly });
    return NextResponse.json({ notifications: items });
  });
}
