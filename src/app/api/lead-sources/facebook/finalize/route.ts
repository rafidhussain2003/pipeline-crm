import { NextRequest, NextResponse } from "next/server";
import { getSession, verifyShortLived } from "@/lib/auth";
import { PENDING_PAGES_COOKIE, FacebookPage, subscribePageToLeadgenWebhook } from "@/lib/facebook-oauth";
import { db } from "@/db";
import { leadSources } from "@/db/schema";
import { encrypt } from "@/lib/crypto";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can connect pages" }, { status: 403 });
  }

  const { pageId } = await req.json();
  if (!pageId) return NextResponse.json({ error: "pageId is required" }, { status: 400 });

  const token = req.cookies.get(PENDING_PAGES_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Your Facebook connection expired. Please connect again." }, { status: 400 });

  const payload = verifyShortLived<{ companyId: string; pages: FacebookPage[] }>(token);
  if (!payload || payload.companyId !== session.companyId) {
    return NextResponse.json({ error: "Your Facebook connection expired. Please connect again." }, { status: 400 });
  }

  const page = payload.pages.find((p) => p.id === pageId);
  if (!page) return NextResponse.json({ error: "Page not found in this session" }, { status: 404 });

  try {
    await subscribePageToLeadgenWebhook(page.id, page.access_token);
  } catch (err) {
    console.error("Failed to subscribe page webhook:", err);
    return NextResponse.json({ error: "Facebook rejected the webhook subscription for this page." }, { status: 400 });
  }

  const [source] = await db
    .insert(leadSources)
    .values({
      companyId: session.companyId,
      platform: "facebook",
      pageId: page.id,
      pageName: page.name,
      accessToken: encrypt(page.access_token),
      status: "active",
    })
    .returning();

  return NextResponse.json({ source: { id: source.id, pageId: page.id, pageName: page.name } });
}
