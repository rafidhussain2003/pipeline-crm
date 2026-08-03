import type { NextConfig } from "next";

// Content-Security-Policy is deliberately NOT included here yet — it's the
// one security header most likely to silently break something (Next.js
// hydration scripts, the Facebook OAuth redirect flow, embedded assets),
// and there's no way to verify it live in this environment. Add it as its
// own, separately-tested change once someone can click through the app
// with it enabled.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HSTS only matters over HTTPS (which Render terminates for us); harmless
  // over local HTTP dev since browsers ignore it on non-TLS connections.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

// The PUBLIC marketing pages carry zero personalization — the same bytes for
// every visitor, no session, no cookies. Marking them CDN-cacheable lets a CDN
// (Cloudflare/Render edge) serve them from a nearby PoP instead of round-
// tripping to the single origin region on every request — which is what makes
// the public site slow/timeout-prone from far-away countries (e.g. India) while
// staying fast near the origin (US). `s-maxage` is SHARED-cache only (CDNs),
// never the browser, so a deploy still propagates quickly; `stale-while-
// revalidate` keeps the edge instant while it refreshes in the background.
//
// SAFETY: this is scoped to an EXPLICIT allow-list of public routes below.
// Authenticated/app/API routes are NEVER given a shared-cache header (that
// would risk serving one user's page to another) — they keep the default
// no-store behavior.
const publicCacheHeaders = [
  { key: "Cache-Control", value: "public, s-maxage=600, stale-while-revalidate=86400" },
];
const PUBLIC_MARKETING_PATHS = ["/", "/pricing", "/contact", "/privacy", "/terms", "/data-deletion"];

const nextConfig: NextConfig = {
  output: "standalone",
  // The boot migrator (src/instrumentation.ts) reads ./drizzle at runtime.
  // Standalone output only bundles traced imports, so without this the
  // deployed server had NO migrations folder — the migrator failed on every
  // boot and the database silently fell behind the code (the root cause of
  // the "blank dispositions" / "finance 500" incidents).
  outputFileTracingIncludes: {
    "/**": ["./drizzle/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      // Edge-cacheable ONLY for the explicit public marketing pages.
      ...PUBLIC_MARKETING_PATHS.map((source) => ({ source, headers: publicCacheHeaders })),
    ];
  },
};

export default nextConfig;
