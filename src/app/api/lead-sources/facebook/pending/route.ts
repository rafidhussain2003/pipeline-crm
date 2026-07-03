import { NextRequest, NextResponse } from "next/server";
import { getSession, verifyShortLived } from "@/lib/auth";
import { PENDING_PAGES_COOKIE, FacebookPage } from "@/lib/facebook-oauth";
import { db } from "@/db";
import { leadSources } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = req.cookies.get(PENDING_PAGES_COOKIE)?.value;
  if (!token) return NextResponse.json({ pages: [] });

  const payload = verifyShortLived<{ companyId: string; pages: FacebookPage[] }>(token);
  if (!payload || payload.companyId !== session.companyId) {
    return NextResponse.json({ pages: [] });
  }

  const existing = await db
    .select({ pageId: leadSources.pageId })
    .from(leadSources)
    .where(eq(leadSources.companyId, session.companyId));
  const connectedIds = new Set(existing.map((r) => r.pageId));

  const pages = payload.pages
    .filter((p) => !connectedIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name }));

  return NextResponse.json({ pages });
}
