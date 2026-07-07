import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isBillingBlocked } from "@/lib/billing";

const COOKIE_NAME = "crm_session";

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

  const isAppRoute = pathname.startsWith("/leads") || pathname.startsWith("/settings");
  const isSuperAdminRoute = pathname.startsWith("/super-admin");
  const isApiRoute = pathname.startsWith("/api/");

  if ((isAppRoute || isSuperAdminRoute) && !session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (isSuperAdminRoute && session?.role !== "super_admin") {
    const url = req.nextUrl.clone();
    url.pathname = "/leads";
    return NextResponse.redirect(url);
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
      .select({ subscriptionStatus: companies.subscriptionStatus, trialEndsAt: companies.trialEndsAt })
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/leads/:path*", "/settings/:path*", "/super-admin/:path*", "/api/:path*"],
};
