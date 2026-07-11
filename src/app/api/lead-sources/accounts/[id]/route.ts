import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { connectedAccounts, leadSources } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq, isNull } from "drizzle-orm";
import { disconnectOneSource } from "@/lib/lead-sources/actions";
import { recordAudit } from "@/lib/audit";

// Disconnect an entire connected account — every Page under it, in one
// click (see the Lead Sources page's per-account Disconnect button).
// Loops over disconnectOneSource() per page (same function the single-page
// Disconnect button calls) rather than a separate bulk implementation, so
// there's exactly one place that knows how to safely disconnect a page.
// Each page's own row (token, status, webhook subscription) is untouched
// for every OTHER account — accounts are isolated by construction, not by
// anything this endpoint has to enforce itself.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can disconnect an account" }, { status: 403 });
  }
  const { id } = await params;

  const [account] = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.id, id), eq(connectedAccounts.companyId, session.companyId), isNull(connectedAccounts.deletedAt)))
    .limit(1);
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sources = await db
    .select()
    .from(leadSources)
    .where(and(eq(leadSources.accountId, id), isNull(leadSources.deletedAt)));

  for (const source of sources) {
    await disconnectOneSource(source, { userId: session.userId, companyId: session.companyId });
  }

  await db
    .update(connectedAccounts)
    .set({ status: "disconnected", deletedAt: new Date() })
    .where(eq(connectedAccounts.id, id));

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "connected_account.disconnected",
    entityType: "connected_account",
    entityId: id,
    before: { accountLabel: account.accountLabel, pageCount: sources.length },
  });

  return NextResponse.json({ ok: true, pagesDisconnected: sources.length });
}
