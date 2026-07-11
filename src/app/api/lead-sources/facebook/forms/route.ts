import { NextRequest, NextResponse } from "next/server";
import { getSession, verifyShortLived } from "@/lib/auth";
import { PENDING_PAGES_COOKIE } from "@/lib/facebook-oauth";
import type { ProviderContainer } from "@/lib/lead-sources/provider";
import { getProvider } from "@/lib/lead-sources/registry";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";

// Called after the admin picks a Page from the pending-selection panel —
// fetches that page's Lead Ad forms on demand (not all pages' forms
// up front, which would be wasted Graph API calls for pages they don't
// end up connecting). The page access token used here comes from the
// signed pending-pages cookie set by the OAuth callback, never from the
// client — the frontend only ever sends a pageId.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = checkPolicy("oauth.facebook", getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const pageId = searchParams.get("pageId");
  if (!pageId) return NextResponse.json({ error: "pageId is required" }, { status: 400 });

  const token = req.cookies.get(PENDING_PAGES_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Your Facebook connection expired. Please connect again." }, { status: 400 });

  const payload = verifyShortLived<{ companyId: string; pages: ProviderContainer[] }>(token);
  if (!payload || payload.companyId !== session.companyId) {
    return NextResponse.json({ error: "Your Facebook connection expired. Please connect again." }, { status: 400 });
  }

  const page = payload.pages.find((p) => p.id === pageId);
  if (!page) return NextResponse.json({ error: "Page not found in this session" }, { status: 404 });

  try {
    const forms = await getProvider("facebook")!.listForms(page.id, page.accessToken);
    return NextResponse.json({ forms });
  } catch (err) {
    console.error("Failed to fetch Facebook lead forms:", err);
    return NextResponse.json({ error: "Could not load lead forms for this page. Please try again." }, { status: 502 });
  }
}
