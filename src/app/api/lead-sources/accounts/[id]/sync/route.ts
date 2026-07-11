import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { connectedAccounts, leadSources } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq, isNull } from "drizzle-orm";
import { checkPolicy } from "@/lib/rate-limit";
import { syncOneSource } from "@/lib/lead-sources/actions";

// "Sync Now" for an entire connected account — every Page under it, in one
// click. Loops over syncOneSource() per page (same function the
// single-page Sync Now button calls), so a failure on one page (expired
// token, removed page) doesn't stop the others in the same account from
// syncing.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can sync an account" }, { status: 403 });
  }
  const { id } = await params;

  const rl = checkPolicy("lead_sources.account_sync", session.userId);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  const [account] = await db
    .select({ id: connectedAccounts.id })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.id, id), eq(connectedAccounts.companyId, session.companyId), isNull(connectedAccounts.deletedAt)))
    .limit(1);
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sources = await db
    .select()
    .from(leadSources)
    .where(and(eq(leadSources.accountId, id), isNull(leadSources.deletedAt)));

  let newFormsFound = 0;
  let failedPages = 0;
  for (const source of sources) {
    const result = await syncOneSource(source, { userId: session.userId, companyId: session.companyId });
    if (result.ok) newFormsFound += result.newFormsFound;
    else failedPages += 1;
  }

  return NextResponse.json({ ok: true, pagesSynced: sources.length - failedPages, failedPages, newFormsFound });
}
