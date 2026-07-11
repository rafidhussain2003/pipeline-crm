// The single source of truth for this app's own public-facing URL — use
// this anywhere a route needs to build an ABSOLUTE URL for something
// outside the current request/response cycle (an OAuth provider's
// redirect_uri, a Stripe success/cancel/return URL, a redirect target).
//
// Deliberately never derived from the incoming request (`req.url`,
// `req.nextUrl.origin`, or the `Host` header) — behind Render's reverse
// proxy, the Node process sees an internal service hostname
// (srv-xxxxxxxx:10000), not the public domain. Any URL built from the
// request in that environment silently points somewhere no browser or
// OAuth provider can reach: Facebook's OAuth dialog rejects a redirect_uri
// that doesn't match its registered public one, and a plain redirect (e.g.
// "not logged in, go to /login") resolves to an internal hostname that
// fails with ERR_NAME_NOT_RESOLVED in the browser.
//
// Resolution order:
//   1. APP_URL — explicit override. Set this if the app is served from a
//      custom domain, or hosted somewhere other than Render.
//   2. RENDER_EXTERNAL_URL — Render automatically injects this into every
//      web service's environment with the correct public
//      https://*.onrender.com URL. No configuration needed for this to
//      work correctly on Render.
//   3. http://localhost:3000 — local dev fallback (next dev's default port).
export function getPublicAppUrl(): string {
  const raw = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}
