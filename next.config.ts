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

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
