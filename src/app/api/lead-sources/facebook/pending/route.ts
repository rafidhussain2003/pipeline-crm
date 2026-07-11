import { NextRequest, NextResponse } from "next/server";
import { getSession, verifyShortLived } from "@/lib/auth";
import { PENDING_PAGES_COOKIE } from "@/lib/facebook-oauth";
import type { ProviderContainer } from "@/lib/lead-sources/provider";
import { db } from "@/db";
import { leadSources, leadForms, connectedAccounts } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

type PendingSelection = {
  companyId: string;
  accountId: string;
  pages: ProviderContainer[];
  tokenExpiresIn: number | null;
  reconnectSourceId: string | null;
};

const EMPTY_RESPONSE = { pages: [], reconnectSourceId: null, existingFormIds: [], accountLabel: null };

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = req.cookies.get(PENDING_PAGES_COOKIE)?.value;
  if (!token) return NextResponse.json(EMPTY_RESPONSE);

  const payload = verifyShortLived<PendingSelection>(token);
  if (!payload || payload.companyId !== session.companyId) {
    return NextResponse.json(EMPTY_RESPONSE);
  }

  const [account] = await db
    .select({ accountLabel: connectedAccounts.accountLabel })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, payload.accountId))
    .limit(1);

  const existing = await db
    .select({ pageId: leadSources.pageId })
    .from(leadSources)
    .where(and(eq(leadSources.companyId, session.companyId), isNull(leadSources.deletedAt)));
  const connectedIds = new Set(existing.map((r) => r.pageId));

  // A reconnect flow re-picks a page that's already connected (to the
  // source being reconnected) — don't filter it out of the list in that
  // case, since that's exactly the page the customer needs to see.
  const pages = payload.pages
    .filter((p) => payload.reconnectSourceId || !connectedIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, business: p.business }));

  let existingFormIds: string[] = [];
  if (payload.reconnectSourceId) {
    const rows = await db
      .select({ formId: leadForms.formId })
      .from(leadForms)
      .where(and(eq(leadForms.sourceId, payload.reconnectSourceId), eq(leadForms.enabled, true)));
    existingFormIds = rows.map((r) => r.formId);
  }

  return NextResponse.json({
    pages,
    reconnectSourceId: payload.reconnectSourceId,
    existingFormIds,
    accountLabel: account?.accountLabel || null,
  });
}
