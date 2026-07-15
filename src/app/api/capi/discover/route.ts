import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { connectedAccounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { listBusinesses, listAdAccounts, listPixels } from "@/lib/capi";

// Pixel-selection discovery: given a connected Meta account, walk
// Business → Ad Account → Pixel using the reused OAuth token. Returns the level
// requested by the query (businesses | adAccounts | pixels). Admin/manager only.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.companyId || (session.role !== "admin" && session.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId");
  if (!accountId) return NextResponse.json({ error: "accountId is required" }, { status: 400 });

  // Tenant isolation: the account must belong to this company.
  const [acct] = await db
    .select({ token: connectedAccounts.accessToken })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.id, accountId), eq(connectedAccounts.companyId, session.companyId), eq(connectedAccounts.platform, "facebook")))
    .limit(1);
  if (!acct) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (!acct.token) return NextResponse.json({ error: "This account needs to be reconnected to grant Conversions API access." }, { status: 409 });

  let token: string;
  try {
    token = decrypt(acct.token);
  } catch {
    return NextResponse.json({ error: "Stored token could not be read — reconnect the account." }, { status: 409 });
  }

  try {
    const adAccountId = searchParams.get("adAccountId");
    if (adAccountId) {
      const pixels = await listPixels(token, adAccountId);
      return NextResponse.json({ pixels });
    }
    const businessId = searchParams.get("businessId");
    if (businessId !== null) {
      const adAccounts = await listAdAccounts(token, businessId || null);
      return NextResponse.json({ adAccounts });
    }
    const businesses = await listBusinesses(token);
    return NextResponse.json({ businesses });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Discovery failed" }, { status: 502 });
  }
}
