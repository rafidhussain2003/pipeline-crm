import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";

const COOKIE_NAME = "crm_session";

export function proxy(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? verifySession(token) : null;
  const { pathname } = req.nextUrl;

  const isAppRoute = pathname.startsWith("/leads") || pathname.startsWith("/settings");
  const isSuperAdminRoute = pathname.startsWith("/super-admin");

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

  return NextResponse.next();
}

export const config = {
  matcher: ["/leads/:path*", "/settings/:path*", "/super-admin/:path*"],
};
