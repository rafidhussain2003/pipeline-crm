import type { MetadataRoute } from "next";

// Phase 14 — robots.txt. Marketing pages are indexable; the authenticated CRM
// (and its APIs, super-admin, and per-user areas) are disallowed from crawlers.
const SITE_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://ziplod.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/super-admin/", "/leads", "/settings/", "/operations", "/team", "/profile", "/subscription", "/onboarding", "/f/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
