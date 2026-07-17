import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isBillingBlocked } from "@/lib/billing";
import { getPublicAppUrl } from "@/lib/url";
import { featureService, FEATURE_DISABLED_MESSAGE } from "@/lib/features";

const COOKIE_NAME = "crm_session";

// Phase 18 Feature Management — the module → URL surface map, enforced at
// this same single chokepoint the billing gate already established (see its
// comment below for why: ~60 routes, one check). A company with a module
// disabled gets 403 "Feature Not Enabled" on its APIs and a redirect off its
// pages, so the module simply doesn't exist for them. Matching is on the
// PATH; the entitlement comes from featureService (cached, 60s TTL in this
// module graph) — rules are checked first so non-gated paths (the vast
// majority) never resolve features at all.
//
// Adding a future module's protection = one entry here (or requireFeature()
// inside its routes — same service either way).
const FEATURE_RULES: { feature: string; match: (p: string) => boolean }[] = [
  // Finance (Phase 19) — the whole bounded context behind one rule. Note the
  // trailing slash / exact match so the public form path "/f/…" never collides.
  { feature: "finance", match: (p) => p === "/finance" || p.startsWith("/finance/") || p.startsWith("/api/finance") },
  // Order matters: the progressive sub-path must match before ai_assignment.
  { feature: "progressive_lead_release", match: (p) => p.startsWith("/api/automation-settings/progressive") },
  { feature: "ai_assignment", match: (p) => p.startsWith("/api/automation-settings") || p.startsWith("/settings/automation") },
  { feature: "callback_engine", match: (p) => p.startsWith("/api/callbacks") || p.startsWith("/callbacks") },
  { feature: "operations_center", match: (p) => p.startsWith("/api/operations") || p.startsWith("/operations") },
  { feature: "website_forms", match: (p) => p.startsWith("/api/website") || p.startsWith("/settings/website-forms") },
  { feature: "historical_imports", match: (p) => p.startsWith("/api/lead-sources/") && p.includes("/import") },
  {
    feature: "meta_integration",
    match: (p) =>
      p.startsWith("/api/capi") ||
      p.startsWith("/api/oauth/facebook") ||
      p.startsWith("/api/lead-sources/facebook") ||
      p.startsWith("/api/lead-sources/accounts") ||
      p.startsWith("/settings/connector") ||
      p.startsWith("/settings/conversions"),
  },
];

// API routes that must stay reachable no matter what a company's
// subscription status is: auth (login/signup/logout/refresh/change-
// password all live under /api/auth), Stripe/Facebook/generic webhooks
// (server-to-server calls that never carry a crm_session cookie anyway),
// health checks, billing itself (a blocked company must still be able to
// check its status and pay), super-admin (platform-level, not billed),
// and cron (internal jobs authenticated by a header secret, not a
// session cookie).
const BILLING_EXEMPT_API_PREFIXES = [
  "/api/auth/",
  "/api/webhooks/",
  "/api/health",
  "/api/billing/",
  "/api/super-admin/",
  "/api/cron/",
];

export async function proxy(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? verifySession(token) : null;
  const { pathname } = req.nextUrl;

  const isAppRoute =
    pathname.startsWith("/leads") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/callbacks") ||
    pathname.startsWith("/operations") ||
    pathname === "/finance" ||
    pathname.startsWith("/finance/");
  const isSuperAdminRoute = pathname.startsWith("/super-admin");
  const isApiRoute = pathname.startsWith("/api/");

  // Built from getPublicAppUrl(), never req.nextUrl.clone() — behind
  // Render's reverse proxy, req.nextUrl reflects an internal service
  // hostname, not the public domain (see lib/url.ts). A redirect built
  // from it sends the browser to an address it can't resolve.
  if ((isAppRoute || isSuperAdminRoute) && !session) {
    return NextResponse.redirect(new URL("/login", getPublicAppUrl()));
  }

  if (isSuperAdminRoute && session?.role !== "super_admin") {
    return NextResponse.redirect(new URL("/leads", getPublicAppUrl()));
  }

  // Subscription gate — the single chokepoint every company-scoped API
  // route passes through, so no individual route (there are ~60 of them)
  // needs its own copy of this check. Only applies to sessions that
  // actually belong to a company (super_admin has companyId = null and is
  // never subject to this) and skips the explicit exemptions above.
  if (
    isApiRoute &&
    session?.companyId &&
    !BILLING_EXEMPT_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    const [company] = await db
      .select({
        subscriptionStatus: companies.subscriptionStatus,
        trialEndsAt: companies.trialEndsAt,
        currentPeriodEnd: companies.currentPeriodEnd,
        stripeSubscriptionId: companies.stripeSubscriptionId,
      })
      .from(companies)
      .where(eq(companies.id, session.companyId))
      .limit(1);

    if (company && isBillingBlocked(company)) {
      return NextResponse.json(
        {
          error: "Your subscription is inactive. Please subscribe to continue using Pipeline CRM.",
          code: "SUBSCRIPTION_REQUIRED",
        },
        { status: 402 }
      );
    }
  }

  // Feature gate (Phase 18) — company sessions only (super_admin has
  // companyId = null and manages features rather than being subject to them;
  // public endpoints carry no session and gate themselves in-route by the
  // form/source's company).
  if (session?.companyId) {
    const rule = FEATURE_RULES.find((r) => r.match(pathname));
    if (rule && !(await featureService.isEnabled(session.companyId, rule.feature))) {
      if (isApiRoute) {
        return NextResponse.json({ error: FEATURE_DISABLED_MESSAGE }, { status: 403 });
      }
      // A page of a module the company doesn't have: send them home as if
      // the page never existed.
      return NextResponse.redirect(new URL("/leads", getPublicAppUrl()));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/leads/:path*",
    "/settings/:path*",
    "/callbacks/:path*",
    "/operations/:path*",
    "/finance/:path*",
    "/super-admin/:path*",
    "/api/:path*",
  ],
};
